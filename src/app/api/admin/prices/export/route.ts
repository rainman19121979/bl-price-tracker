import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 600;
export const runtime = "nodejs";

/**
 * Admin-only: Export der Preisdaten (parts + price_sales + price_stock +
 * price_daily) als NDJSON-Stream.
 *
 * KEIN Voll-Backup -- Watchlist, User, API-Keys, my_sales bleiben draussen.
 * Zweck: Instanz-Umzug oder Merge zwischen eigenen Instanzen.
 *
 * ACHTUNG BrickLink TOS: die Daten stammen aus der BL-API und duerfen nicht
 * an Dritte weitergegeben werden -- der User traegt die Verantwortung fuer
 * seine Datei (UI-Warnhinweis, README, NOTICE.md).
 *
 * Format: NDJSON, eine Zeile pro Record.
 *   Header:  {type:"header", version:1, exportedAt: ISO, counts:{...}}
 *   parts:   {t:"p", d:{id,partNo,colorId,itemType,...}}
 *   sales:   {t:"s", d:{...}}   (partId ist source-id, wird beim Import remapped)
 *   stock:   {t:"k", d:{...}}
 *   daily:   {t:"d", d:{...}}  (informativ -- Import ignoriert und rekomputet)
 *
 * Streaming per id-basierter Cursor-Pagination in 5000er-Batches -- keine
 * Composite-Cursor-Probleme, keine grossen offsets, kein RAM-Blowup.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id || !session.user.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [partCount, salesCount, stockCount, dailyCount] = await Promise.all([
    prisma.part.count(),
    prisma.priceSale.count(),
    prisma.priceStock.count(),
    prisma.priceDaily.count(),
  ]);

  const encoder = new TextEncoder();
  const BATCH = 5000;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const header = {
          type: "header", version: 1,
          exportedAt: new Date().toISOString(),
          counts: { parts: partCount, sales: salesCount, stock: stockCount, daily: dailyCount },
        };
        controller.enqueue(encoder.encode(JSON.stringify(header) + "\n"));

        // parts -- alle Metadaten, aber KEINE crawl-Timestamps (die gehoeren
        // dem lokalen Crawler-State der Ziel-Instanz).
        let lastPartId = 0;
        while (true) {
          const rows = await prisma.part.findMany({
            take: BATCH,
            where: { id: { gt: lastPartId } },
            orderBy: { id: "asc" },
            select: {
              id: true, partNo: true, colorId: true, itemType: true,
              partName: true, colorName: true,
              categoryId: true, categoryName: true, imageUrl: true,
            },
          });
          if (rows.length === 0) break;
          for (const r of rows) {
            controller.enqueue(encoder.encode(JSON.stringify({ t: "p", d: r }) + "\n"));
          }
          lastPartId = rows[rows.length - 1].id;
        }

        // price_sales -- via raw SQL, weil der Composite PK (id,dateOrdered)
        // Prisma-Cursor unnoetig kompliziert macht. id ist BIGSERIAL, strikt
        // aufsteigend -- WHERE id > $1 ORDER BY id LIMIT reicht.
        let lastSaleId: bigint = 0n;
        while (true) {
          const rows = await prisma.$queryRaw<Array<{
            id: bigint; part_id: number; date_ordered: Date;
            unit_price: string; quantity: number;
            seller_country: string; buyer_country: string | null;
            new_or_used: string; completeness: string | null;
            fetched_at: Date;
          }>>`
            SELECT id, part_id, date_ordered, unit_price::text, quantity,
                   seller_country, buyer_country, new_or_used, completeness, fetched_at
            FROM price_sales
            WHERE id > ${lastSaleId}
            ORDER BY id ASC
            LIMIT ${BATCH}
          `;
          if (rows.length === 0) break;
          for (const r of rows) {
            controller.enqueue(encoder.encode(JSON.stringify({
              t: "s",
              d: {
                partId: r.part_id,
                dateOrdered: r.date_ordered.toISOString(),
                unitPrice: r.unit_price,
                quantity: r.quantity,
                sellerCountry: r.seller_country,
                buyerCountry: r.buyer_country,
                newOrUsed: r.new_or_used,
                completeness: r.completeness,
                fetchedAt: r.fetched_at.toISOString().slice(0, 10),
              },
            }) + "\n"));
          }
          lastSaleId = rows[rows.length - 1].id;
        }

        // price_stock
        let lastStockId: bigint = 0n;
        while (true) {
          const rows = await prisma.$queryRaw<Array<{
            id: bigint; part_id: number; unit_price: string; quantity: number;
            seller_country: string; new_or_used: string;
            completeness: string | null; fetched_at: Date;
          }>>`
            SELECT id, part_id, unit_price::text, quantity,
                   seller_country, new_or_used, completeness, fetched_at
            FROM price_stock
            WHERE id > ${lastStockId}
            ORDER BY id ASC
            LIMIT ${BATCH}
          `;
          if (rows.length === 0) break;
          for (const r of rows) {
            controller.enqueue(encoder.encode(JSON.stringify({
              t: "k",
              d: {
                partId: r.part_id,
                unitPrice: r.unit_price,
                quantity: r.quantity,
                sellerCountry: r.seller_country,
                newOrUsed: r.new_or_used,
                completeness: r.completeness,
                fetchedAt: r.fetched_at.toISOString().slice(0, 10),
              },
            }) + "\n"));
          }
          lastStockId = rows[rows.length - 1].id;
        }

        // price_daily -- informativ, Import ignoriert und rekomputet
        let lastDailyId: bigint = 0n;
        while (true) {
          const rows = await prisma.$queryRaw<Array<{
            id: bigint; part_id: number; fetch_date: Date; new_or_used: string;
            seller_country: string; currency_code: string;
            min_price: string | null; max_price: string | null;
            avg_price: string | null; qty_avg_price: string | null;
            unit_quantity: number | null; total_quantity: number | null;
          }>>`
            SELECT id, part_id, fetch_date, new_or_used, seller_country, currency_code,
                   min_price::text, max_price::text, avg_price::text, qty_avg_price::text,
                   unit_quantity, total_quantity
            FROM price_daily
            WHERE id > ${lastDailyId}
            ORDER BY id ASC
            LIMIT ${BATCH}
          `;
          if (rows.length === 0) break;
          for (const r of rows) {
            controller.enqueue(encoder.encode(JSON.stringify({
              t: "d",
              d: {
                partId: r.part_id,
                fetchDate: r.fetch_date.toISOString().slice(0, 10),
                newOrUsed: r.new_or_used,
                sellerCountry: r.seller_country,
                currencyCode: r.currency_code,
                minPrice: r.min_price,
                maxPrice: r.max_price,
                avgPrice: r.avg_price,
                qtyAvgPrice: r.qty_avg_price,
                unitQuantity: r.unit_quantity,
                totalQuantity: r.total_quantity,
              },
            }) + "\n"));
          }
          lastDailyId = rows[rows.length - 1].id;
        }

        controller.close();
      } catch (err) {
        console.error("[prices/export] error:", err);
        controller.error(err);
      }
    },
  });

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson",
      "Content-Disposition": `attachment; filename="bl-price-tracker-prices-${date}.ndjson"`,
      "Cache-Control": "no-store",
    },
  });
}
