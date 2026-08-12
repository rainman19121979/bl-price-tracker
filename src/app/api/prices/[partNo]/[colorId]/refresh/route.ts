import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/encryption";
import { BrickLinkClient } from "@/lib/bricklink-api";
import { validatePartParams } from "@/lib/validate-params";
import { getUsage, logApiCall } from "@/lib/api-usage";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { partNo: string; colorId: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = parseInt(session.user.id);
  let validParams;
  try {
    validParams = validatePartParams(params);
  } catch {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
  }
  const { partNo, colorId } = validParams;

  let body: { newOrUsed?: string } = {};
  try {
    body = await request.json();
  } catch {
    // default to U
  }
  const newOrUsed = (body.newOrUsed === "N" ? "N" : "U") as "N" | "U";

  // Find part — try PART, MINIFIG, SET
  let part = await prisma.part.findUnique({
    where: { partNo_colorId_itemType: { partNo, colorId, itemType: "PART" } },
  });
  if (!part) {
    part = await prisma.part.findUnique({
      where: { partNo_colorId_itemType: { partNo, colorId, itemType: "MINIFIG" } },
    });
  }
  if (!part) {
    part = await prisma.part.findUnique({
      where: { partNo_colorId_itemType: { partNo, colorId, itemType: "SET" } },
    });
  }
  if (!part) {
    return NextResponse.json({ error: "Teil nicht gefunden" }, { status: 404 });
  }

  return await fetchPrice(part, newOrUsed, userId);
}

async function fetchPrice(
  part: { id: number; partNo: string; colorId: number; itemType: string },
  newOrUsed: "N" | "U",
  userId: number
) {
  const apiKey = await prisma.userApiKey.findFirst({
    where: { userId, isValid: true },
    orderBy: { createdAt: "desc" },
  });

  if (!apiKey) {
    return NextResponse.json({ error: "Kein API-Key" }, { status: 400 });
  }

  const used = await getUsage(apiKey.id);
  if (used + 2 > apiKey.dailyLimit) {
    return NextResponse.json({ error: "Tageslimit erreicht (2 Calls noetig)" }, { status: 429 });
  }

  const consumerSecret = decrypt(apiKey.consumerSecretEnc);
  const tokenSecret = decrypt(apiKey.tokenSecretEnc);

  const client = new BrickLinkClient(
    apiKey.consumerKey, consumerSecret, apiKey.tokenValue, tokenSecret, 0
  );

  try {
    const response = await client.getPriceGuide(
      part.partNo, part.itemType, part.colorId, newOrUsed
    );

    const data = response.data;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Save individual sales
    if (data.price_detail?.length > 0) {
      for (const sale of data.price_detail) {
        const dateOrdered = new Date(sale.date_ordered);
        const unitPrice = parseFloat(sale.unit_price);
        await prisma.$executeRaw`
          INSERT INTO price_sales (part_id, date_ordered, unit_price, quantity,
            seller_country, buyer_country, new_or_used, fetched_at, created_at)
          VALUES (${part.id}, ${dateOrdered}, ${unitPrice}::decimal(10,4),
            ${sale.quantity}, ${sale.seller_country_code || "DE"},
            ${sale.buyer_country_code || null}, ${newOrUsed}, ${today}, NOW())
          ON CONFLICT DO NOTHING
        `;
      }

      // Build daily aggregates
      const dailyMap = new Map<string, { prices: number[]; quantities: number[] }>();
      for (const sale of data.price_detail) {
        const day = sale.date_ordered.split("T")[0];
        const entry = dailyMap.get(day) || { prices: [], quantities: [] };
        entry.prices.push(parseFloat(sale.unit_price));
        entry.quantities.push(sale.quantity);
        dailyMap.set(day, entry);
      }

      for (const [dayStr, { prices, quantities }] of Array.from(dailyMap.entries())) {
        const fetchDate = new Date(dayStr);
        fetchDate.setHours(0, 0, 0, 0);
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
        const totalQty = quantities.reduce((a, b) => a + b, 0);
        const qtyAvgPrice = prices.reduce((sum, p, i) => sum + p * quantities[i], 0) / totalQty;

        await prisma.priceDaily.upsert({
          where: {
            partId_fetchDate_newOrUsed_sellerCountry: {
              partId: part.id, fetchDate, newOrUsed, sellerCountry: "DE",
            },
          },
          update: { minPrice, maxPrice, avgPrice, qtyAvgPrice, unitQuantity: prices.length, totalQuantity: totalQty },
          create: {
            partId: part.id, fetchDate, newOrUsed, sellerCountry: "DE",
            currencyCode: "EUR", minPrice, maxPrice, avgPrice, qtyAvgPrice,
            unitQuantity: prices.length, totalQuantity: totalQty,
          },
        });
      }
    }

    // Update sold timestamp (shared + per-condition)
    const now = new Date();
    await prisma.part.update({
      where: { id: part.id },
      data: {
        lastPriceUpdate: now,
        ...(newOrUsed === "N" ? { lastSoldCrawlN: now } : { lastSoldCrawlU: now }),
      },
    });

    // --- Stock: aktuelle Angebote ---
    let stockCount = 0;
    try {
      const stockResponse = await client.getPriceGuide(
        part.partNo, part.itemType, part.colorId, newOrUsed, "DE", "stock"
      );
      const stockData = stockResponse.data;

      // Alten Snapshot löschen + neu einfügen
      await prisma.$executeRaw`
        DELETE FROM price_stock WHERE part_id = ${part.id} AND new_or_used = ${newOrUsed} AND fetched_at = ${today}
      `;

      if (stockData.price_detail?.length > 0) {
        for (const offer of stockData.price_detail) {
          await prisma.$executeRaw`
            INSERT INTO price_stock (part_id, unit_price, quantity, seller_country, new_or_used, fetched_at, created_at)
            VALUES (${part.id}, ${parseFloat(offer.unit_price)}::decimal(10,4), ${offer.quantity}, 'DE', ${newOrUsed}, ${today}, NOW())
            ON CONFLICT DO NOTHING
          `;
        }
        stockCount = stockData.price_detail.length;
      }

      await prisma.part.update({
        where: { id: part.id },
        data: {
          lastStockUpdate: new Date(),
          ...(newOrUsed === "N" ? { lastStockCrawlN: new Date() } : { lastStockCrawlU: new Date() }),
        },
      });
    } catch {
      // Stock-Fehler nicht fatal
    }

    // 2 API-Calls (sold + stock)
    await logApiCall(apiKey.id, 2);

    return NextResponse.json({
      success: true,
      avgPrice: data.avg_price,
      sales: data.price_detail?.length || 0,
      stockOffers: stockCount,
    });
  } catch (error) {
    console.error('[refresh] Error:', error);
    return NextResponse.json(
      { error: "Ein Fehler ist aufgetreten" },
      { status: 500 }
    );
  }
}
