import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getCountryFilters } from "@/lib/user-settings";
import { evaluateFormula, findMatchingRule, type PricingRule } from "@/lib/pricing-engine";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = parseInt(session.user.id);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { pricingFormulas: true },
  });

  let pricingRules: PricingRule[] = [];
  if (user?.pricingFormulas) {
    try { pricingRules = JSON.parse(user.pricingFormulas); } catch { /* ignore */ }
  }

  const { shippingCountries, sellerCountries } = await getCountryFilters(userId);
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const params: unknown[] = [userId, sixMonthsAgo];
  let p = 3;
  let soldCf = "";
  if (shippingCountries) { soldCf += ` AND s.buyer_country = ANY($${p++})`; params.push(shippingCountries); }
  if (sellerCountries)   { soldCf += ` AND s.seller_country = ANY($${p++})`; params.push(sellerCountries); }
  let stockCf = "";
  let stockCfOuter = "";
  if (sellerCountries) {
    const idx = p++;
    stockCf = ` AND seller_country = ANY($${idx})`;
    stockCfOuter = ` AND s.seller_country = ANY($${idx})`;
    params.push(sellerCountries);
  }

  // Get all watchlist items with price data for formula evaluation
  const items = await prisma.$queryRawUnsafe<Array<{
    part_no: string; color_id: number; item_type: string; part_name: string | null; sale_rate: number; price_locked: boolean;
    color_name: string | null; category_id: number | null; category_name: string | null;
    new_or_used: string; my_price: number; my_quantity: number; my_cost: number | null;
    bl_inventory_id: number | null; description: string | null; remarks: string | null;
    bulk: number | null; bl_date_added: Date | null;
    sold6m_median: number | null; sold6m_avg: number | null;
    stock_median: number | null; stock_avg: number | null;
    stock_min: number | null; stock_max: number | null;
    stock_count: number; stock_qty: number;
  }>>(
    `WITH user_lots AS (
      SELECT part_id, new_or_used FROM user_watchlists WHERE user_id = $1
    ),
    latest_stock AS (
      SELECT DISTINCT ON (part_id, new_or_used) part_id, new_or_used, fetched_at
      FROM price_stock
      WHERE (part_id, new_or_used) IN (SELECT part_id, new_or_used FROM user_lots)
        ${stockCf}
      ORDER BY part_id, new_or_used, fetched_at DESC
    ),
    stock_stats AS (
      SELECT s.part_id, s.new_or_used,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.unit_price)::float as stock_median,
        (SUM(s.unit_price * s.quantity) / NULLIF(SUM(s.quantity), 0))::float as stock_avg,
        MIN(s.unit_price)::float as stock_min, MAX(s.unit_price)::float as stock_max,
        COUNT(*)::int as stock_count, COALESCE(SUM(s.quantity), 0)::int as stock_qty
      FROM price_stock s
      JOIN latest_stock ls
        ON ls.part_id = s.part_id AND ls.new_or_used = s.new_or_used AND ls.fetched_at = s.fetched_at
        ${stockCfOuter}
      GROUP BY s.part_id, s.new_or_used
    ),
    sold_stats AS (
      SELECT s.part_id, s.new_or_used,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.unit_price)::float as sold6m_median,
        (SUM(s.unit_price * s.quantity) / NULLIF(SUM(s.quantity), 0))::float as sold6m_avg
      FROM price_sales s
      WHERE (s.part_id, s.new_or_used) IN (SELECT part_id, new_or_used FROM user_lots)
        AND s.date_ordered >= $2 ${soldCf}
      GROUP BY s.part_id, s.new_or_used
    )
    SELECT p.part_no, p.color_id, p.item_type, p.part_name, p.color_name,
      p.category_id, p.category_name, w.new_or_used,
      COALESCE(w.my_price, 0)::float AS my_price,
      COALESCE(w.my_quantity, 0)::int AS my_quantity,
      w.my_cost::float AS my_cost,
      w.bl_inventory_id, w.description, w.remarks, w.bulk, w.bl_date_added,
      w.sale_rate, w.price_locked,
      sold_stats.sold6m_median, sold_stats.sold6m_avg,
      stock_stats.stock_median, stock_stats.stock_avg,
      stock_stats.stock_min, stock_stats.stock_max,
      COALESCE(stock_stats.stock_count, 0)::int AS stock_count,
      COALESCE(stock_stats.stock_qty, 0)::int AS stock_qty
    FROM user_watchlists w
    JOIN parts p ON p.id = w.part_id
    LEFT JOIN sold_stats ON sold_stats.part_id = p.id AND sold_stats.new_or_used = w.new_or_used
    LEFT JOIN stock_stats ON stock_stats.part_id = p.id AND stock_stats.new_or_used = w.new_or_used
    WHERE w.user_id = $1 AND w.bl_inventory_id IS NOT NULL`,
    ...params
  );

  // Map item_type to BrickStore ItemTypeID
  const typeMap: Record<string, string> = { PART: "P", MINIFIG: "M", SET: "S" };
  const typeNameMap: Record<string, string> = { PART: "Part", MINIFIG: "Minifig", SET: "Set" };

  // Build BSX XML
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<BrickStoreXML>\n';
  xml += ' <Inventory Currency="EUR">\n';

  for (const item of items) {
    // Calculate suggested price via formula (skip if price is locked)
    let price = item.my_price;
    if (pricingRules.length > 0 && !item.price_locked) {
      const rule = findMatchingRule(pricingRules, {
        itemType: item.item_type, condition: item.new_or_used,
        colorId: item.color_id, categoryId: item.category_id,
      });
      if (rule) {
        const vars = {
          sold6mMedian: item.sold6m_median ?? 0, sold6mAvg: item.sold6m_avg ?? 0,
          soldMedian: item.sold6m_median ?? 0, soldAvg: item.sold6m_avg ?? 0,
          stockMedian: item.stock_median ?? 0, stockAvg: item.stock_avg ?? 0,
          stockMin: item.stock_min ?? 0, stockMax: item.stock_max ?? 0,
          stockCount: item.stock_count, stockQty: item.stock_qty,
          myPrice: item.my_price, myQty: item.my_quantity, myCost: item.my_cost ?? 0,
          sold7dMedian: 0, sold30dMedian: 0, sold60dMedian: 0, sold90dMedian: 0,
          sold7dAvg: 0, sold30dAvg: 0, sold60dAvg: 0, sold90dAvg: 0,
          sold6mMin: 0, sold6mMax: 0, sold30dCount: 0, sold90dCount: 0, sold6mCount: 0,
          sold30dQty: 0, sold90dQty: 0, sold6mQty: 0,
        };
        const suggested = evaluateFormula(rule.formula, vars);
        if (suggested && suggested > 0) price = suggested;
      }
    }

    const esc = (s: string | null) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    xml += '  <Item>\n';
    xml += `   <ItemID>${esc(item.part_no)}</ItemID>\n`;
    xml += `   <ItemTypeID>${typeMap[item.item_type] || "P"}</ItemTypeID>\n`;
    xml += `   <ColorID>${item.color_id}</ColorID>\n`;
    xml += `   <ItemName>${esc(item.part_name)}</ItemName>\n`;
    xml += `   <ItemTypeName>${typeNameMap[item.item_type] || "Part"}</ItemTypeName>\n`;
    xml += `   <ColorName>${esc(item.color_name)}</ColorName>\n`;
    if (item.category_id) xml += `   <CategoryID>${item.category_id}</CategoryID>\n`;
    if (item.category_name) xml += `   <CategoryName>${esc(item.category_name)}</CategoryName>\n`;
    xml += `   <Status>I</Status>\n`;
    xml += `   <Qty>${item.my_quantity}</Qty>\n`;
    // Formel-Preis direkt als Basispreis, BL zieht Rabatt im <Sale>-Tag ab
    // (B-Ware bekommt so zusätzlich 15% Rabatt auf den Formelpreis)
    const basePrice = Math.round(price * 1000) / 1000;
    const saleRate = item.sale_rate || 0;
    xml += `   <Price>${basePrice.toFixed(3)}</Price>\n`;
    xml += `   <Condition>${item.new_or_used}</Condition>\n`;
    // Cost is per-unit; DB stores lot total → divide by qty
    if (item.my_cost != null && item.my_cost > 0 && item.my_quantity > 0) {
      const costPerUnit = item.my_cost / item.my_quantity;
      xml += `   <Cost>${costPerUnit.toFixed(3)}</Cost>\n`;
    }
    // Remarks = private BL "Remarks" field (Lagerplatz, z.B. TA039) — NEVER the public description!
    if (item.remarks) xml += `   <Remarks>${esc(item.remarks)}</Remarks>\n`;
    // Comments = public BL "Description" — this is what buyers see
    if (item.description) xml += `   <Comments>${esc(item.description)}</Comments>\n`;
    if (saleRate > 0) xml += `   <Sale>${saleRate}</Sale>\n`;
    if (item.bulk && item.bulk > 1) xml += `   <Bulk>${item.bulk}</Bulk>\n`;
    // LotID = BL inventory_id — BrickStore matches by this on re-upload to avoid overwriting existing lots
    if (item.bl_inventory_id) xml += `   <LotID>${item.bl_inventory_id}</LotID>\n`;
    if (item.bl_date_added) {
      xml += `   <DateAdded>${item.bl_date_added.toISOString().replace(/\.\d{3}Z$/, "Z")}</DateAdded>\n`;
    }
    xml += '  </Item>\n';
  }

  xml += ' </Inventory>\n';
  xml += '</BrickStoreXML>\n';

  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml",
      "Content-Disposition": 'attachment; filename="pricetracker-empf-preise.bsx"',
    },
  });
}
