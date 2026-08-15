import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recomputePriceDaily } from "@/lib/price-daily-rollup";

export const dynamic = "force-dynamic";
export const maxDuration = 900;
export const runtime = "nodejs";

/**
 * Admin-only: Preisdaten aus einem Export-NDJSON additiv einmergen.
 *
 * Semantik:
 *   - parts: Upsert auf (partNo, colorId, itemType). Metadaten werden nur
 *     gesetzt wenn Ziel-Zeile NULL hat -- lokal gepflegte Daten bleiben.
 *   - price_sales / price_stock: INSERT ... ON CONFLICT DO NOTHING gegen die
 *     erweiterten Dedup-Indizes (die completeness + NULLS NOT DISTINCT
 *     seit Migration 20260815120000 kennen).
 *   - price_daily aus Import wird ignoriert; stattdessen werden die
 *     betroffenen (partId,date,zustand)-Kombis nach dem Sales-Merge neu
 *     aus price_sales aggregiert (recomputePriceDaily).
 *
 * part_id-Remapping: Export-parts haben Source-IDs. Beim Import bauen wir
 * eine Map<sourceId, targetId> anhand (partNo,colorId,itemType) und
 * uebersetzen alle nachfolgenden sales/stock/daily-Zeilen entsprechend.
 *
 * ACHTUNG BrickLink TOS: dieser Endpoint kann Daten anderer BL-Accounts
 * hereinmergen -- der User traegt die TOS-Verantwortung fuer die Datei.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || !session.user.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Multipart-Body erwartet" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Kein 'file' im Form-Body" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "Datei ist leer" }, { status: 400 });
  }
  if (file.size > 1024 * 1024 * 1024) {
    return NextResponse.json({ error: "Datei > 1 GB — bitte splitten" }, { status: 400 });
  }

  const t0 = Date.now();
  const text = await file.text();
  const lines = text.split("\n").filter(l => l.length > 0);

  if (lines.length === 0) {
    return NextResponse.json({ error: "Datei enthaelt keine Zeilen" }, { status: 400 });
  }

  // Preflight: erste Zeile muss der Header sein
  let header: { type: string; version: number; counts?: Record<string, number> };
  try {
    header = JSON.parse(lines[0]);
  } catch {
    return NextResponse.json({ error: "Erste Zeile ist kein JSON" }, { status: 400 });
  }
  if (header.type !== "header" || header.version !== 1) {
    return NextResponse.json({
      error: "Ungueltiger Header -- erwarte {type:'header', version:1}",
    }, { status: 400 });
  }

  // Sammelphase: alle Zeilen in typisierte Arrays
  const partsIn: Array<{ id: number; partNo: string; colorId: number; itemType: string;
    partName: string | null; colorName: string | null;
    categoryId: number | null; categoryName: string | null;
    imageUrl: string | null }> = [];
  const salesIn: Array<{ partId: number; dateOrdered: string; unitPrice: string;
    quantity: number; sellerCountry: string; buyerCountry: string | null;
    newOrUsed: string; completeness: string | null; fetchedAt: string }> = [];
  const stockIn: Array<{ partId: number; unitPrice: string; quantity: number;
    sellerCountry: string; newOrUsed: string; completeness: string | null;
    fetchedAt: string }> = [];

  for (let i = 1; i < lines.length; i++) {
    let parsed: { t: string; d: Record<string, unknown> };
    try {
      parsed = JSON.parse(lines[i]);
    } catch {
      return NextResponse.json({
        error: `Zeile ${i + 1} ist kein JSON`,
      }, { status: 400 });
    }
    if (parsed.t === "p") partsIn.push(parsed.d as never);
    else if (parsed.t === "s") salesIn.push(parsed.d as never);
    else if (parsed.t === "k") stockIn.push(parsed.d as never);
    // "d" (daily) wird ignoriert -- wird nach dem Sales-Merge neu berechnet
  }

  // 1) parts upserten und ID-Map bauen
  const idMap = new Map<number, number>();
  let partsAdded = 0;
  let partsExisting = 0;
  for (const p of partsIn) {
    const existing = await prisma.part.findUnique({
      where: { partNo_colorId_itemType: { partNo: p.partNo, colorId: p.colorId, itemType: p.itemType } },
      select: {
        id: true, partName: true, colorName: true,
        categoryId: true, categoryName: true, imageUrl: true,
      },
    });
    if (existing) {
      idMap.set(p.id, existing.id);
      partsExisting++;
      // Metadaten nur nachtragen wo lokal NULL -- lokale Werte gewinnen
      const patch: Record<string, unknown> = {};
      if (!existing.partName && p.partName) patch.partName = p.partName;
      if (!existing.colorName && p.colorName) patch.colorName = p.colorName;
      if (!existing.categoryId && p.categoryId) patch.categoryId = p.categoryId;
      if (!existing.categoryName && p.categoryName) patch.categoryName = p.categoryName;
      if (!existing.imageUrl && p.imageUrl) patch.imageUrl = p.imageUrl;
      if (Object.keys(patch).length > 0) {
        await prisma.part.update({ where: { id: existing.id }, data: patch });
      }
    } else {
      const created = await prisma.part.create({
        data: {
          partNo: p.partNo, colorId: p.colorId, itemType: p.itemType,
          partName: p.partName, colorName: p.colorName,
          categoryId: p.categoryId, categoryName: p.categoryName,
          imageUrl: p.imageUrl,
        },
      });
      idMap.set(p.id, created.id);
      partsAdded++;
    }
  }

  // 2) sales mergen -- die betroffenen (partId,date,zustand)-Kombis fuer den
  //    daily-Recompute im Set sammeln.
  const affectedDaily = new Map<string, { partId: number; date: Date; newOrUsed: 'N' | 'U' }>();
  let salesAdded = 0;
  let salesExisting = 0;
  const SALES_CHUNK = 500;

  for (let i = 0; i < salesIn.length; i += SALES_CHUNK) {
    const chunk = salesIn.slice(i, i + SALES_CHUNK);
    await Promise.all(chunk.map(async (s) => {
      const targetPartId = idMap.get(s.partId);
      if (!targetPartId) return;  // Source-part nicht in map (sollte nie passieren)
      const dateOrdered = new Date(s.dateOrdered);
      const fetchedAt = new Date(s.fetchedAt);
      const cond = s.newOrUsed === 'N' ? 'N' : 'U';

      const result = await prisma.$executeRaw`
        INSERT INTO price_sales
          (part_id, date_ordered, unit_price, quantity, seller_country,
           buyer_country, new_or_used, completeness, fetched_at, created_at)
        VALUES
          (${targetPartId}, ${dateOrdered},
           ${s.unitPrice}::decimal(10,4), ${s.quantity},
           ${s.sellerCountry}, ${s.buyerCountry},
           ${cond}, ${s.completeness}, ${fetchedAt}, NOW())
        ON CONFLICT DO NOTHING
      `;
      if (result > 0) {
        salesAdded++;
        const dayKey = dateOrdered.toISOString().slice(0, 10);
        const setKey = `${targetPartId}:${dayKey}:${cond}`;
        if (!affectedDaily.has(setKey)) {
          const d = new Date(dayKey + "T00:00:00.000Z");
          affectedDaily.set(setKey, { partId: targetPartId, date: d, newOrUsed: cond });
        }
      } else {
        salesExisting++;
      }
    }));
  }

  // 3) stock mergen
  let stockAdded = 0;
  let stockExisting = 0;
  const STOCK_CHUNK = 500;

  for (let i = 0; i < stockIn.length; i += STOCK_CHUNK) {
    const chunk = stockIn.slice(i, i + STOCK_CHUNK);
    await Promise.all(chunk.map(async (k) => {
      const targetPartId = idMap.get(k.partId);
      if (!targetPartId) return;
      const fetchedAt = new Date(k.fetchedAt);
      const cond = k.newOrUsed === 'N' ? 'N' : 'U';

      const result = await prisma.$executeRaw`
        INSERT INTO price_stock
          (part_id, unit_price, quantity, seller_country,
           new_or_used, completeness, fetched_at, created_at)
        VALUES
          (${targetPartId}, ${k.unitPrice}::decimal(10,4), ${k.quantity},
           ${k.sellerCountry}, ${cond}, ${k.completeness}, ${fetchedAt}, NOW())
        ON CONFLICT DO NOTHING
      `;
      if (result > 0) stockAdded++;
      else stockExisting++;
    }));
  }

  // 4) daily rekomputen fuer alle Kombis in denen wir neue Sales gemergt haben
  let dailyRecomputed = 0;
  try {
    dailyRecomputed = await recomputePriceDaily(Array.from(affectedDaily.values()));
  } catch (err) {
    console.error("[prices/import] recomputePriceDaily failed:", err);
    // Import bleibt erfolgreich -- daily-Cache ist nur Perf-Optimierung
  }

  return NextResponse.json({
    ok: true,
    parts: { added: partsAdded, existing: partsExisting, total: partsIn.length },
    sales: { added: salesAdded, existing: salesExisting, total: salesIn.length },
    stock: { added: stockAdded, existing: stockExisting, total: stockIn.length },
    daily: { recomputed: dailyRecomputed, affected: affectedDaily.size },
    durationMs: Date.now() - t0,
    header: { exportedAt: (header as { exportedAt?: string }).exportedAt ?? null },
  });
}
