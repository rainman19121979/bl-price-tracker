import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getCountryFilters } from "@/lib/user-settings";
import { redis } from "@/lib/redis";
import { evaluateFormula, findMatchingRule, type PricingRule, type PricingVars } from "@/lib/pricing-engine";

interface ValueRow {
  my_value: number;
  sold_median_value: number;
  sold_qty_avg_value: number;
  stock_median_value: number;
  stock_qty_avg_value: number;
}

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = parseInt(session.user.id);

  const cacheKey = `watchlist:value:${userId}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return NextResponse.json(JSON.parse(cached));
  } catch { /* redis down */ }

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const { shippingCountries, sellerCountries } = await getCountryFilters(userId);

  const queryArgs: (number | Date | string[])[] = [userId, sixMonthsAgo];
  let p = 3;
  let soldCf = "";
  if (shippingCountries) { soldCf += ` AND buyer_country = ANY($${p++})`; queryArgs.push(shippingCountries); }
  if (sellerCountries)   { soldCf += ` AND seller_country = ANY($${p++})`; queryArgs.push(sellerCountries); }
  let stockCf = "";
  let stockCfOuter = "";
  if (sellerCountries) {
    const idx = p++;
    stockCf = ` AND seller_country = ANY($${idx})`;
    stockCfOuter = ` AND s.seller_country = ANY($${idx})`;
    queryArgs.push(sellerCountries);
  }

  // Fast path: precompute the latest fetched_at per (part_id, new_or_used)
  // among the user's own lots, then join stock stats against that.
  // Replaces the previous per-row correlated subquery (30-60s on 10k lots).
  const result = await prisma.$queryRawUnsafe<ValueRow[]>(
    `WITH user_lots AS (
      SELECT part_id, new_or_used, completeness
      FROM user_watchlists
      WHERE user_id = $1 AND my_price IS NOT NULL AND my_quantity > 0
    ),
    latest_stock AS (
      SELECT DISTINCT ON (part_id, new_or_used, completeness)
        part_id, new_or_used, completeness, fetched_at
      FROM price_stock
      WHERE (part_id, new_or_used) IN (SELECT part_id, new_or_used FROM user_lots)
        ${stockCf}
      ORDER BY part_id, new_or_used, completeness, fetched_at DESC
    ),
    stock_stats AS (
      SELECT s.part_id, s.new_or_used, s.completeness,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.unit_price)::float as median_price,
        (SUM(s.unit_price * s.quantity) / NULLIF(SUM(s.quantity), 0))::float as qty_avg_price
      FROM price_stock s
      JOIN latest_stock ls
        ON ls.part_id = s.part_id AND ls.new_or_used = s.new_or_used
        AND ls.completeness IS NOT DISTINCT FROM s.completeness
        AND ls.fetched_at = s.fetched_at
        ${stockCfOuter}
      GROUP BY s.part_id, s.new_or_used, s.completeness
    )
    SELECT
      COALESCE(SUM(w.my_price * w.my_quantity), 0)::float as my_value,
      COALESCE(SUM(CASE WHEN sold.median_price IS NOT NULL THEN sold.median_price * w.my_quantity ELSE 0 END), 0)::float as sold_median_value,
      COALESCE(SUM(CASE WHEN sold.qty_avg_price IS NOT NULL THEN sold.qty_avg_price * w.my_quantity ELSE 0 END), 0)::float as sold_qty_avg_value,
      COALESCE(SUM(CASE WHEN stock.median_price IS NOT NULL THEN stock.median_price * w.my_quantity ELSE 0 END), 0)::float as stock_median_value,
      COALESCE(SUM(CASE WHEN stock.qty_avg_price IS NOT NULL THEN stock.qty_avg_price * w.my_quantity ELSE 0 END), 0)::float as stock_qty_avg_value
    FROM user_watchlists w
    LEFT JOIN LATERAL (
      SELECT
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unit_price)::float as median_price,
        (SUM(unit_price * quantity) / NULLIF(SUM(quantity), 0))::float as qty_avg_price
      FROM price_sales
      WHERE part_id = w.part_id AND new_or_used = w.new_or_used
        AND completeness IS NOT DISTINCT FROM w.completeness
        AND date_ordered >= $2 ${soldCf}
    ) sold ON true
    LEFT JOIN stock_stats stock
      ON stock.part_id = w.part_id AND stock.new_or_used = w.new_or_used
      AND stock.completeness IS NOT DISTINCT FROM w.completeness
    WHERE w.user_id = $1
      AND w.my_price IS NOT NULL
      AND w.my_quantity IS NOT NULL
      AND w.my_quantity > 0`,
    ...queryArgs,
  );

  const row = result[0] || { my_value: 0, sold_median_value: 0, sold_qty_avg_value: 0, stock_median_value: 0, stock_qty_avg_value: 0 };

  let formulaValue = 0;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { pricingFormulas: true } });
  let pricingRules: PricingRule[] = [];
  if (user?.pricingFormulas) {
    try { pricingRules = JSON.parse(user.pricingFormulas); } catch { /* ignore */ }
  }

  if (pricingRules.length > 0) {
    const lots = await prisma.$queryRawUnsafe<Array<{
      my_price: number; my_quantity: number; my_cost: number | null; new_or_used: string; completeness: string | null; sale_rate: number; price_locked: boolean;
      item_type: string; color_id: number; category_id: number | null;
      sold_median: number | null; sold_avg: number | null;
      stock_median: number | null; stock_avg: number | null;
      stock_min: number | null; stock_max: number | null;
      stock_count: number; stock_qty: number;
    }>>(
      `WITH user_lots AS (
        SELECT part_id, new_or_used, completeness
        FROM user_watchlists
        WHERE user_id = $1 AND my_price IS NOT NULL AND my_quantity > 0
      ),
      latest_stock AS (
        SELECT DISTINCT ON (part_id, new_or_used, completeness) part_id, new_or_used, completeness, fetched_at
        FROM price_stock
        WHERE (part_id, new_or_used) IN (SELECT part_id, new_or_used FROM user_lots)
          ${stockCf}
        ORDER BY part_id, new_or_used, completeness, fetched_at DESC
      ),
      stock_stats AS (
        SELECT s.part_id, s.new_or_used, s.completeness,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.unit_price)::float as median_price,
          (SUM(s.unit_price * s.quantity) / NULLIF(SUM(s.quantity), 0))::float as qty_avg_price,
          MIN(s.unit_price)::float as min_price, MAX(s.unit_price)::float as max_price,
          COUNT(*)::int as cnt, COALESCE(SUM(s.quantity), 0)::int as qty
        FROM price_stock s
        JOIN latest_stock ls
          ON ls.part_id = s.part_id AND ls.new_or_used = s.new_or_used
          AND ls.completeness IS NOT DISTINCT FROM s.completeness
          AND ls.fetched_at = s.fetched_at
          ${stockCfOuter}
        GROUP BY s.part_id, s.new_or_used, s.completeness
      )
      SELECT w.my_price::float, w.my_quantity, w.my_cost::float, w.new_or_used, w.completeness, w.sale_rate, w.price_locked,
        p.item_type, p.color_id, p.category_id,
        sold.median_price as sold_median, sold.qty_avg_price as sold_avg,
        stock.median_price as stock_median, stock.qty_avg_price as stock_avg,
        stock.min_price as stock_min, stock.max_price as stock_max,
        COALESCE(stock.cnt, 0)::int as stock_count, COALESCE(stock.qty, 0)::int as stock_qty
      FROM user_watchlists w
      JOIN parts p ON p.id = w.part_id
      LEFT JOIN LATERAL (
        SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unit_price)::float as median_price,
          (SUM(unit_price * quantity) / NULLIF(SUM(quantity), 0))::float as qty_avg_price
        FROM price_sales WHERE part_id = w.part_id AND new_or_used = w.new_or_used
          AND completeness IS NOT DISTINCT FROM w.completeness
          AND date_ordered >= $2 ${soldCf}
      ) sold ON true
      LEFT JOIN stock_stats stock
        ON stock.part_id = w.part_id AND stock.new_or_used = w.new_or_used
        AND stock.completeness IS NOT DISTINCT FROM w.completeness
      WHERE w.user_id = $1 AND w.my_price IS NOT NULL AND w.my_quantity > 0`,
      ...queryArgs,
    );

    for (const lot of lots) {
      let price = lot.my_price;
      if (!lot.price_locked) {
        const rule = findMatchingRule(pricingRules, {
          itemType: lot.item_type, condition: lot.new_or_used,
          colorId: lot.color_id, categoryId: lot.category_id, completeness: lot.completeness,
        });
        if (rule) {
          const vars: PricingVars = {
            sold6mMedian: lot.sold_median ?? 0, sold6mAvg: lot.sold_avg ?? 0,
            soldMedian: lot.sold_median ?? 0, soldAvg: lot.sold_avg ?? 0,
            stockMedian: lot.stock_median ?? 0, stockAvg: lot.stock_avg ?? 0,
            stockMin: lot.stock_min ?? 0, stockMax: lot.stock_max ?? 0,
            stockCount: lot.stock_count, stockQty: lot.stock_qty,
            myPrice: lot.my_price, myQty: lot.my_quantity, myCost: lot.my_cost ?? 0,
            sold7dMedian: 0, sold30dMedian: 0, sold60dMedian: 0, sold90dMedian: 0,
            sold7dAvg: 0, sold30dAvg: 0, sold60dAvg: 0, sold90dAvg: 0,
            sold6mMin: 0, sold6mMax: 0, sold30dCount: 0, sold90dCount: 0, sold6mCount: 0,
            sold30dQty: 0, sold90dQty: 0, sold6mQty: 0,
          };
          const suggested = evaluateFormula(rule.formula, vars);
          if (suggested && suggested > 0) price = suggested;
        }
      }
      price = Math.round(price * 1000) / 1000;
      formulaValue += price * lot.my_quantity;
    }
  }

  const responseData = {
    myValue: Math.round(row.my_value * 100) / 100,
    soldMedianValue: Math.round(row.sold_median_value * 100) / 100,
    soldQtyAvgValue: Math.round(row.sold_qty_avg_value * 100) / 100,
    stockMedianValue: Math.round(row.stock_median_value * 100) / 100,
    stockQtyAvgValue: Math.round(row.stock_qty_avg_value * 100) / 100,
    formulaValue: pricingRules.length > 0 ? Math.round(formulaValue * 100) / 100 : null,
  };

  try {
    await redis.set(cacheKey, JSON.stringify(responseData), 'EX', 300);
  } catch { /* redis down */ }

  return NextResponse.json(responseData);
}
