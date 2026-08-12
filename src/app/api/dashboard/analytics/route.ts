import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getShippingCountries } from "@/lib/user-settings";
import { evaluateFormula, findMatchingRule, type PricingRule } from "@/lib/pricing-engine";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = parseInt(session.user.id);
  const countries = await getShippingCountries(userId);
  const d90 = new Date(Date.now() - 90 * 86400000);

  const cf = countries ? "AND s.buyer_country = ANY($3)" : "";
  const baseParams: unknown[] = [userId, d90];
  if (countries) baseParams.push(countries);

  const [slowMovers, marginAnalysis, turnover] = await Promise.all([
    // B) Ladenhüter — wenigste Verkäufe vs. eigenem Bestand
    prisma.$queryRawUnsafe<Array<{
      part_no: string; color_id: number; part_name: string | null;
      color_name: string | null; item_type: string; new_or_used: string;
      my_quantity: number; my_price: number; qty_sold: number;
    }>>(
      `SELECT p.part_no, p.color_id, p.part_name, p.color_name, p.item_type,
        w.new_or_used, COALESCE(w.my_quantity, 0)::int AS my_quantity,
        COALESCE(w.my_price, 0)::float AS my_price,
        COALESCE(sales.qty, 0)::int AS qty_sold
      FROM user_watchlists w
      JOIN parts p ON p.id = w.part_id
      LEFT JOIN LATERAL (
        SELECT SUM(s.quantity) AS qty FROM price_sales s
        WHERE s.part_id = p.id AND s.new_or_used = w.new_or_used
          AND s.date_ordered >= $2 ${cf}
      ) sales ON true
      WHERE w.user_id = $1 AND COALESCE(w.my_quantity, 0) > 0 AND NOT w.price_locked
      ORDER BY COALESCE(sales.qty, 0) ASC, w.my_quantity DESC
      LIMIT 25`,
      ...baseParams
    ),

    // C) Margen-Analyse — wird nach dem Promise.all aus den Watchlist-Daten berechnet
    // (nutzt suggestedPrice aus Preisformeln statt eigene Berechnung)
    Promise.resolve([]),

    // E) Durchsatz-Ranking — bestes Verhältnis verkauft/bestand
    prisma.$queryRawUnsafe<Array<{
      part_no: string; color_id: number; part_name: string | null;
      color_name: string | null; item_type: string; new_or_used: string;
      my_quantity: number; qty_sold: number; turnover: number; avg_price: number;
    }>>(
      `SELECT p.part_no, p.color_id, p.part_name, p.color_name, p.item_type,
        w.new_or_used, COALESCE(w.my_quantity, 0)::int AS my_quantity,
        COALESCE(sales.qty, 0)::int AS qty_sold,
        CASE WHEN COALESCE(w.my_quantity, 0) > 0
          THEN (COALESCE(sales.qty, 0)::float / w.my_quantity) ELSE 0 END AS turnover,
        COALESCE(sales.avg_price, 0)::float AS avg_price
      FROM user_watchlists w
      JOIN parts p ON p.id = w.part_id
      LEFT JOIN LATERAL (
        SELECT SUM(s.quantity) AS qty, AVG(s.unit_price) AS avg_price FROM price_sales s
        WHERE s.part_id = p.id AND s.new_or_used = w.new_or_used
          AND s.date_ordered >= $2 ${cf}
      ) sales ON true
      WHERE w.user_id = $1 AND COALESCE(w.my_quantity, 0) > 0
        AND COALESCE(sales.qty, 0) > 0
      ORDER BY COALESCE(sales.qty, 0) DESC
      LIMIT 25`,
      ...baseParams
    ),
  ]);

  // C) Margen-Analyse — myPrice vs suggestedPrice (aus Preisformeln)
  const userFormulas = await prisma.user.findUnique({ where: { id: userId }, select: { pricingFormulas: true } });
  let pricingRules: PricingRule[] = [];
  if (userFormulas?.pricingFormulas) {
    try { pricingRules = JSON.parse(userFormulas.pricingFormulas); } catch { /* ignore */ }
  }

  interface MarginItem {
    partNo: string; colorId: number; partName: string | null;
    colorName: string | null; itemType: string; newOrUsed: string;
    myPrice: number; marketAvg: number; diffPct: number;
  }

  let marginOverpriced: MarginItem[] = [];
  let marginUnderpriced: MarginItem[] = [];

  if (pricingRules.length > 0) {
    const sixMonthsAgo = new Date(); sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const marginData = await prisma.$queryRawUnsafe<Array<{
      part_id: number; part_no: string; color_id: number; part_name: string | null;
      color_name: string | null; item_type: string; new_or_used: string;
      category_id: number | null; my_price: number;
      sold6m_median: number | null; sold6m_avg: number | null;
      stock_median: number | null; stock_avg: number | null;
    }>>(
      `WITH user_lots AS (
        SELECT p.id as part_id, p.part_no, p.color_id, p.part_name, p.color_name, p.item_type, p.category_id,
          w.new_or_used, (w.my_price::float * (1 - w.sale_rate / 100.0)) AS my_price
        FROM user_watchlists w JOIN parts p ON p.id = w.part_id
        WHERE w.user_id = $1 AND w.my_price IS NOT NULL AND w.my_price > 0 AND NOT w.price_locked
      ),
      sold_stats AS (
        SELECT s.part_id, s.new_or_used,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.unit_price)::float as sold_median,
          (SUM(s.unit_price * s.quantity) / NULLIF(SUM(s.quantity), 0))::float as sold_avg
        FROM price_sales s
        WHERE s.part_id IN (SELECT part_id FROM user_lots)
          AND s.date_ordered >= $2 ${cf}
        GROUP BY s.part_id, s.new_or_used
      ),
      latest_stock AS (
        SELECT DISTINCT ON (part_id, new_or_used) part_id, new_or_used, fetched_at
        FROM price_stock
        WHERE part_id IN (SELECT part_id FROM user_lots)
        ORDER BY part_id, new_or_used, fetched_at DESC
      ),
      stock_stats AS (
        SELECT ps.part_id, ps.new_or_used,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ps.unit_price)::float as stock_median,
          (SUM(ps.unit_price * ps.quantity) / NULLIF(SUM(ps.quantity), 0))::float as stock_avg
        FROM price_stock ps
        JOIN latest_stock l ON l.part_id = ps.part_id AND l.new_or_used = ps.new_or_used AND l.fetched_at = ps.fetched_at
        GROUP BY ps.part_id, ps.new_or_used
      )
      SELECT ul.part_id, ul.part_no, ul.color_id, ul.part_name, ul.color_name, ul.item_type, ul.category_id,
        ul.new_or_used, ul.my_price,
        ss.sold_median as sold6m_median, ss.sold_avg as sold6m_avg,
        stk.stock_median, stk.stock_avg
      FROM user_lots ul
      LEFT JOIN sold_stats ss ON ss.part_id = ul.part_id AND ss.new_or_used = ul.new_or_used
      LEFT JOIN stock_stats stk ON stk.part_id = ul.part_id AND stk.new_or_used = ul.new_or_used`,
      userId, sixMonthsAgo, ...(countries ? [countries] : [])
    );

    for (const item of marginData) {
      const rule = findMatchingRule(pricingRules, {
        itemType: item.item_type, condition: item.new_or_used,
        colorId: item.color_id, categoryId: item.category_id,
      });
      if (!rule) continue;

      const vars = {
        sold6mMedian: item.sold6m_median ?? 0, sold6mAvg: item.sold6m_avg ?? 0,
        soldMedian: item.sold6m_median ?? 0, soldAvg: item.sold6m_avg ?? 0,
        stockMedian: item.stock_median ?? 0, stockAvg: item.stock_avg ?? 0,
        myPrice: item.my_price, myQty: 0, myCost: 0,
        sold7dMedian: 0, sold30dMedian: 0, sold60dMedian: 0, sold90dMedian: 0,
        sold7dAvg: 0, sold30dAvg: 0, sold60dAvg: 0, sold90dAvg: 0,
        sold6mMin: 0, sold6mMax: 0, sold30dCount: 0, sold90dCount: 0, sold6mCount: 0,
        sold30dQty: 0, sold90dQty: 0, sold6mQty: 0,
        stockMin: 0, stockMax: 0, stockCount: 0, stockQty: 0,
      };

      const suggested = evaluateFormula(rule.formula, vars);
      if (!suggested || suggested <= 0) continue;

      const diffPct = ((item.my_price - suggested) / suggested) * 100;
      const entry: MarginItem = {
        partNo: item.part_no, colorId: item.color_id, partName: item.part_name,
        colorName: item.color_name, itemType: item.item_type, newOrUsed: item.new_or_used,
        myPrice: item.my_price, marketAvg: suggested, diffPct,
      };

      if (diffPct > 15) marginOverpriced.push(entry);
      else if (diffPct < -15) marginUnderpriced.push(entry);
    }

    marginOverpriced.sort((a, b) => b.diffPct - a.diffPct);
    marginUnderpriced.sort((a, b) => a.diffPct - b.diffPct);
    marginOverpriced = marginOverpriced.slice(0, 30);
    marginUnderpriced = marginUnderpriced.slice(0, 30);
  }

  return NextResponse.json({
    slowMovers: slowMovers.map(s => ({
      partNo: s.part_no, colorId: s.color_id, partName: s.part_name,
      colorName: s.color_name, itemType: s.item_type, newOrUsed: s.new_or_used,
      myQuantity: s.my_quantity, myPrice: s.my_price, qtySold: s.qty_sold,
    })),
    marginOverpriced,
    marginUnderpriced,
    turnoverRanking: turnover.map(t => ({
      partNo: t.part_no, colorId: t.color_id, partName: t.part_name,
      colorName: t.color_name, itemType: t.item_type, newOrUsed: t.new_or_used,
      myQuantity: t.my_quantity, qtySold: t.qty_sold,
      turnover: t.turnover, avgPrice: t.avg_price,
    })),
  });
}
