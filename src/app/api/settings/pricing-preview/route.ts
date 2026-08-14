import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getCountryFilters } from "@/lib/user-settings";
import {
  evaluateFormula,
  validateFormula,
  type PricingRule,
  type PricingVars,
} from "@/lib/pricing-engine";

export const dynamic = "force-dynamic";

interface LotSample {
  watchlistId: number;
  partNo: string;
  colorId: number;
  colorName: string | null;
  partName: string | null;
  itemType: string;
  categoryId: number | null;
  newOrUsed: string;
  myPrice: number;
  myQuantity: number;
  myCost: number | null;
  vars: PricingVars;
  suggestedPrice: number | null;
  suggestedRounded: number | null;
  changePct: number | null;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id);

  let body: { rule?: PricingRule };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const rule = body.rule;
  if (!rule || typeof rule.formula !== "string") {
    return NextResponse.json({ error: "rule.formula fehlt" }, { status: 400 });
  }

  const validation = validateFormula(rule.formula);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error, samples: [] }, { status: 200 });
  }

  const { shippingCountries, sellerCountries } = await getCountryFilters(userId);
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const d7 = new Date(Date.now() - 7 * 86400000);
  const d30 = new Date(Date.now() - 30 * 86400000);
  const d60 = new Date(Date.now() - 60 * 86400000);
  const d90 = new Date(Date.now() - 90 * 86400000);

  // Build filter clauses for matching watchlist lots
  const filters = rule.filters ?? { itemType: "*", condition: "*", colorId: [], categoryId: [] };
  const whereClauses: string[] = ["w.user_id = $1", "w.my_price IS NOT NULL", "w.my_quantity > 0"];
  const args: unknown[] = [userId];
  let p = 2;
  if (filters.itemType && filters.itemType !== "*") {
    whereClauses.push(`p.item_type = $${p++}`);
    args.push(filters.itemType);
  }
  if (filters.condition && filters.condition !== "*") {
    whereClauses.push(`w.new_or_used = $${p++}`);
    args.push(filters.condition);
  }
  if (filters.colorId?.length > 0) {
    whereClauses.push(`p.color_id = ANY($${p++})`);
    args.push(filters.colorId);
  }
  if (filters.categoryId?.length > 0) {
    whereClauses.push(`p.category_id = ANY($${p++})`);
    args.push(filters.categoryId);
  }
  if (filters.completeness && filters.completeness !== "*") {
    whereClauses.push(`w.completeness = $${p++}`);
    args.push(filters.completeness);
  }

  const lots = await prisma.$queryRawUnsafe<Array<{
    id: number; part_id: number; part_no: string; color_id: number;
    part_name: string | null; color_name: string | null; item_type: string;
    category_id: number | null; new_or_used: string; completeness: string | null;
    my_price: number; my_quantity: number; my_cost: number | null;
  }>>(
    `SELECT w.id, w.part_id, p.part_no, p.color_id, p.part_name, p.color_name, p.item_type, p.category_id,
      w.new_or_used, w.completeness, w.my_price::float, w.my_quantity, w.my_cost::float
    FROM user_watchlists w JOIN parts p ON p.id = w.part_id
    WHERE ${whereClauses.join(" AND ")}
    ORDER BY w.my_quantity DESC
    LIMIT 3`,
    ...args
  );

  if (lots.length === 0) {
    return NextResponse.json({
      samples: [],
      note: "Kein passendes Lot in deinem Inventar gefunden.",
    });
  }

  const samples: LotSample[] = [];
  for (const lot of lots) {
    const partId = lot.part_id;
    const nou = lot.new_or_used;

    // Sold stats over multiple windows — needs BOTH filters + completeness
    const soldArgs: unknown[] = [partId, nou];
    let sp = 3;
    let cfSold = "";
    if (shippingCountries) { cfSold += ` AND buyer_country = ANY($${sp++})`; soldArgs.push(shippingCountries); }
    if (sellerCountries)   { cfSold += ` AND seller_country = ANY($${sp++})`; soldArgs.push(sellerCountries); }
    if (lot.completeness) { cfSold += ` AND completeness = $${sp++}`; soldArgs.push(lot.completeness); }
    else                  { cfSold += ` AND completeness IS NULL`; }

    const soldRows = await prisma.$queryRawUnsafe<Array<{
      w7d_median: number | null; w30d_median: number | null; w60d_median: number | null;
      w90d_median: number | null; w6m_median: number | null;
      w7d_avg: number | null; w30d_avg: number | null; w60d_avg: number | null;
      w90d_avg: number | null; w6m_avg: number | null;
      w6m_min: number | null; w6m_max: number | null;
      w30d_count: number; w90d_count: number; w6m_count: number;
      w30d_qty: number; w90d_qty: number; w6m_qty: number;
    }>>(
      `SELECT
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unit_price) FILTER (WHERE date_ordered >= $${sp}) ::float as w7d_median,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unit_price) FILTER (WHERE date_ordered >= $${sp+1}) ::float as w30d_median,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unit_price) FILTER (WHERE date_ordered >= $${sp+2}) ::float as w60d_median,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unit_price) FILTER (WHERE date_ordered >= $${sp+3}) ::float as w90d_median,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unit_price) FILTER (WHERE date_ordered >= $${sp+4}) ::float as w6m_median,
        AVG(unit_price) FILTER (WHERE date_ordered >= $${sp}) ::float as w7d_avg,
        AVG(unit_price) FILTER (WHERE date_ordered >= $${sp+1}) ::float as w30d_avg,
        AVG(unit_price) FILTER (WHERE date_ordered >= $${sp+2}) ::float as w60d_avg,
        AVG(unit_price) FILTER (WHERE date_ordered >= $${sp+3}) ::float as w90d_avg,
        AVG(unit_price) FILTER (WHERE date_ordered >= $${sp+4}) ::float as w6m_avg,
        MIN(unit_price) FILTER (WHERE date_ordered >= $${sp+4}) ::float as w6m_min,
        MAX(unit_price) FILTER (WHERE date_ordered >= $${sp+4}) ::float as w6m_max,
        COUNT(*) FILTER (WHERE date_ordered >= $${sp+1}) ::int as w30d_count,
        COUNT(*) FILTER (WHERE date_ordered >= $${sp+3}) ::int as w90d_count,
        COUNT(*) FILTER (WHERE date_ordered >= $${sp+4}) ::int as w6m_count,
        COALESCE(SUM(quantity) FILTER (WHERE date_ordered >= $${sp+1}), 0) ::int as w30d_qty,
        COALESCE(SUM(quantity) FILTER (WHERE date_ordered >= $${sp+3}), 0) ::int as w90d_qty,
        COALESCE(SUM(quantity) FILTER (WHERE date_ordered >= $${sp+4}), 0) ::int as w6m_qty
      FROM price_sales
      WHERE part_id = $1 AND new_or_used = $2 AND date_ordered >= $${sp+4} ${cfSold}`,
      ...soldArgs, d7, d30, d60, d90, sixMonthsAgo
    );
    const s = soldRows[0];

    // Stock stats — outer JOIN must also filter seller_country + completeness
    const stockArgs: unknown[] = [partId, nou];
    let stp = 3;
    let stockCf = "";
    let stockCfOuter = "";
    if (sellerCountries) {
      const idx = stp++;
      stockCf = ` AND seller_country = ANY($${idx})`;
      stockCfOuter = ` AND st.seller_country = ANY($${idx})`;
      stockArgs.push(sellerCountries);
    }
    if (lot.completeness) {
      const idx = stp++;
      stockCf += ` AND completeness = $${idx}`;
      stockCfOuter += ` AND st.completeness = $${idx}`;
      stockArgs.push(lot.completeness);
    } else {
      stockCf += ` AND completeness IS NULL`;
      stockCfOuter += ` AND st.completeness IS NULL`;
    }
    const stockRows = await prisma.$queryRawUnsafe<Array<{
      median: number | null; avg: number | null;
      min: number | null; max: number | null;
      count: number; qty: number;
    }>>(
      `WITH latest AS (
        SELECT MAX(fetched_at) as ts FROM price_stock WHERE part_id = $1 AND new_or_used = $2 ${stockCf}
      )
      SELECT
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY st.unit_price)::float as median,
        AVG(st.unit_price)::float as avg,
        MIN(st.unit_price)::float as min,
        MAX(st.unit_price)::float as max,
        COUNT(*)::int as count,
        COALESCE(SUM(st.quantity), 0)::int as qty
      FROM price_stock st, latest
      WHERE st.part_id = $1 AND st.new_or_used = $2 AND st.fetched_at = latest.ts ${stockCfOuter}`,
      ...stockArgs
    );
    const st = stockRows[0];

    const vars: PricingVars = {
      sold7dMedian: s.w7d_median ?? 0, sold30dMedian: s.w30d_median ?? 0,
      sold60dMedian: s.w60d_median ?? 0, sold90dMedian: s.w90d_median ?? 0,
      sold6mMedian: s.w6m_median ?? 0,
      sold7dAvg: s.w7d_avg ?? 0, sold30dAvg: s.w30d_avg ?? 0,
      sold60dAvg: s.w60d_avg ?? 0, sold90dAvg: s.w90d_avg ?? 0,
      sold6mAvg: s.w6m_avg ?? 0,
      soldMedian: s.w6m_median ?? 0, soldAvg: s.w6m_avg ?? 0,
      sold6mMin: s.w6m_min ?? 0, sold6mMax: s.w6m_max ?? 0,
      sold30dCount: s.w30d_count, sold90dCount: s.w90d_count, sold6mCount: s.w6m_count,
      sold30dQty: s.w30d_qty, sold90dQty: s.w90d_qty, sold6mQty: s.w6m_qty,
      stockMedian: st.median ?? 0, stockAvg: st.avg ?? 0,
      stockMin: st.min ?? 0, stockMax: st.max ?? 0,
      stockCount: st.count, stockQty: st.qty,
      myPrice: lot.my_price, myQty: lot.my_quantity, myCost: lot.my_cost ?? 0,
    };

    const raw = evaluateFormula(rule.formula, vars);
    const rounded = raw !== null && raw > 0 ? Math.round(raw * 1000) / 1000 : raw;
    const changePct = rounded !== null && lot.my_price > 0
      ? ((rounded - lot.my_price) / lot.my_price) * 100
      : null;

    samples.push({
      watchlistId: lot.id,
      partNo: lot.part_no,
      colorId: lot.color_id,
      colorName: lot.color_name,
      partName: lot.part_name,
      itemType: lot.item_type,
      categoryId: lot.category_id,
      newOrUsed: lot.new_or_used,
      myPrice: lot.my_price,
      myQuantity: lot.my_quantity,
      myCost: lot.my_cost,
      vars,
      suggestedPrice: raw,
      suggestedRounded: rounded,
      changePct,
    });
  }

  return NextResponse.json({
    samples,
    filters: { sellerCountries, shippingCountries },
  });
}
