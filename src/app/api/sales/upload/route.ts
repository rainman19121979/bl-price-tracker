import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseBsxContent, findOrCreatePart } from "@/lib/bsx-orders";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Accept multipart/form-data with one or more .bsx files.
// Reuses the same parse + dedup path as the scheduled BSX-Import.
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Multipart-Body erwartet" }, { status: 400 });
  }

  const files: File[] = [];
  for (const [key, val] of form.entries()) {
    if ((key === "files" || key === "files[]") && val instanceof File) files.push(val);
  }
  if (files.length === 0) {
    return NextResponse.json({ error: "Keine Dateien im Feld 'files'" }, { status: 400 });
  }

  let filesProcessed = 0;
  let ordersProcessed = 0;
  let itemsImported = 0;
  let itemsSkipped = 0;
  let partsCreated = 0;
  const errors: Array<{ file: string; error: string }> = [];

  for (const file of files) {
    filesProcessed++;
    if (!file.name.toLowerCase().endsWith(".bsx")) {
      errors.push({ file: file.name, error: "Keine .bsx-Datei" });
      continue;
    }
    // Cap per-file size (BSX order files are tiny — a few KB — so 5 MB is generous)
    if (file.size > 5 * 1024 * 1024) {
      errors.push({ file: file.name, error: "Datei > 5 MB, verdächtig groß" });
      continue;
    }
    try {
      const raw = await file.text();
      const order = await parseBsxContent(raw);
      if (!order) {
        errors.push({ file: file.name, error: "Keine <Order>-Section gefunden" });
        continue;
      }

      const platform = order.service === "BrickOwl" ? "BO" : "BL";
      for (const item of order.items) {
        try {
          const existing = await prisma.part.findUnique({
            where: { partNo_colorId_itemType: { partNo: item.partNo, colorId: item.colorId, itemType: item.itemType } },
            select: { id: true },
          });
          let partId: number;
          if (existing) {
            partId = existing.id;
          } else {
            partId = await findOrCreatePart(item.partNo, item.colorId, item.itemType, item.itemName, item.colorName);
            partsCreated++;
          }
          const inserted = await prisma.$executeRawUnsafe(
            `INSERT INTO my_sales (user_id, part_id, new_or_used, quantity, unit_price, sold_at, platform, order_id, customer)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (user_id, platform, order_id, part_id, new_or_used, unit_price, quantity) DO NOTHING`,
            userId, partId, item.condition, item.quantity, item.price, order.orderDate, platform, order.orderId, order.customer
          );
          if (inserted > 0) itemsImported++;
          else itemsSkipped++;
        } catch (err) {
          errors.push({ file: `${file.name}#${item.partNo}/${item.colorId}`, error: err instanceof Error ? err.message : String(err) });
        }
      }
      ordersProcessed++;
    } catch (err) {
      errors.push({ file: file.name, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({
    ok: true,
    filesProcessed,
    ordersProcessed,
    itemsImported,
    itemsSkipped,
    partsCreated,
    errors: errors.slice(0, 20),
    errorCount: errors.length,
  });
}
