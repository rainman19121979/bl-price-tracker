import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getCountryFilters } from "@/lib/user-settings";
import { validatePartParams } from "@/lib/validate-params";
import { findPart } from "@/lib/find-part";

interface PriceStats {
  new_or_used: string;
  avg_price: number;
  median_price: number;
  qty_avg_price: number;
  min_price: number;
  max_price: number;
  total_sales: number;
  total_quantity: number;
  sale_days: number;
}

interface StockStats {
  new_or_used: string;
  avg_price: number;
  median_price: number;
  qty_avg_price: number;
  total_offers: number;
  total_quantity: number;
}

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { partNo: string; colorId: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let validParams;
  try {
    validParams = validatePartParams(params);
  } catch {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
  }
  const { partNo, colorId } = validParams;
  const userId = parseInt(session.user.id);

  // Completeness-Filter: nur relevant bei SETs. C/I/S; wenn nicht gesetzt bei
  // SETs → Default 'C'. Bei PART/MINIFIG → immer NULL.
  const completenessParam = new URL(request.url).searchParams.get("completeness");
  const completenessFilter = completenessParam === "C" || completenessParam === "I" || completenessParam === "S"
    ? completenessParam
    : null;

  // Phase 1: independent lookups in parallel
  const [part, filters] = await Promise.all([
    findPart(partNo, colorId),
    getCountryFilters(userId),
  ]);
  if (!part) {
    return NextResponse.json({ error: "Part not found" }, { status: 404 });
  }
  const { shippingCountries, sellerCountries } = filters;

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  // Bei SETs mit completeness-Filter: default = 'C' (complete) wenn kein Param
  const isSet = part.itemType === "SET";
  const effectiveCompleteness = isSet ? (completenessFilter ?? "C") : null;

  const queryArgs: (number | Date | string[] | string)[] = [part.id, sixMonthsAgo];
  let p = 3;
  let soldCf = "";
  if (shippingCountries) { soldCf += ` AND buyer_country = ANY($${p++})`; queryArgs.push(shippingCountries); }
  if (sellerCountries)   { soldCf += ` AND seller_country = ANY($${p++})`; queryArgs.push(sellerCountries); }
  if (effectiveCompleteness) { soldCf += ` AND completeness = $${p++}`; queryArgs.push(effectiveCompleteness); }
  else                       { soldCf += ` AND completeness IS NULL`; }

  // Phase 2: sales stats + stock stats in parallel
  const [stats, stockStats] = await Promise.all([
    prisma.$queryRawUnsafe<PriceStats[]>(
      `SELECT new_or_used,
        AVG(unit_price)::float as avg_price,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unit_price)::float as median_price,
        (SUM(unit_price * quantity) / NULLIF(SUM(quantity), 0))::float as qty_avg_price,
        MIN(unit_price)::float as min_price,
        MAX(unit_price)::float as max_price,
        COUNT(*)::int as total_sales,
        COALESCE(SUM(quantity), 0)::int as total_quantity,
        COUNT(DISTINCT date_trunc('day', date_ordered))::int as sale_days
      FROM price_sales
      WHERE part_id = $1 AND date_ordered >= $2 ${soldCf}
      GROUP BY new_or_used`,
      ...queryArgs
    ),
    (async () => {
      const stockArgs: (number | string[] | string)[] = [part.id];
      let q = 2;
      let stockCf = "";
      if (sellerCountries) { stockCf += ` AND seller_country = ANY($${q++})`; stockArgs.push(sellerCountries); }
      if (effectiveCompleteness) { stockCf += ` AND completeness = $${q++}`; stockArgs.push(effectiveCompleteness); }
      else                       { stockCf += ` AND completeness IS NULL`; }
      return prisma.$queryRawUnsafe<StockStats[]>(
        `WITH latest AS (
          SELECT DISTINCT ON (new_or_used) new_or_used, fetched_at
          FROM price_stock WHERE part_id = $1 ${stockCf}
          ORDER BY new_or_used, fetched_at DESC
        )
        SELECT ps.new_or_used,
          AVG(ps.unit_price)::float as avg_price,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ps.unit_price)::float as median_price,
          (SUM(ps.unit_price * ps.quantity) / NULLIF(SUM(ps.quantity), 0))::float as qty_avg_price,
          COUNT(*)::int as total_offers,
          COALESCE(SUM(ps.quantity), 0)::int as total_quantity
        FROM price_stock ps
        JOIN latest l ON ps.new_or_used = l.new_or_used AND ps.fetched_at = l.fetched_at
        WHERE ps.part_id = $1 ${stockCf}
        GROUP BY ps.new_or_used`,
        ...stockArgs
      );
    })(),
  ]);

  const newStats = stats.find((s) => s.new_or_used === "N");
  const usedStats = stats.find((s) => s.new_or_used === "U");
  const newStock = stockStats.find((s) => s.new_or_used === "N");
  const usedStock = stockStats.find((s) => s.new_or_used === "U");

  function buildSold(s: PriceStats | undefined) {
    if (!s) return null;
    return {
      avgPrice: s.avg_price,
      medianPrice: s.median_price,
      qtyAvgPrice: s.qty_avg_price,
      minPrice: s.min_price,
      maxPrice: s.max_price,
      totalSales: s.total_sales,
      totalQuantity: s.total_quantity,
      saleDays: s.sale_days,
    };
  }

  function buildStock(s: StockStats | undefined) {
    if (!s) return null;
    return {
      avgPrice: s.avg_price,
      medianPrice: s.median_price,
      qtyAvgPrice: s.qty_avg_price,
      totalOffers: s.total_offers,
      totalQuantity: s.total_quantity,
    };
  }

  return NextResponse.json({
    part: {
      id: part.id,
      partNo: part.partNo,
      colorId: part.colorId,
      itemType: part.itemType,
      partName: part.partName,
      colorName: part.colorName,
      categoryName: part.categoryName,
      lastPriceUpdate: part.lastPriceUpdate,
    },
    prices: {
      new: buildSold(newStats),
      used: buildSold(usedStats),
    },
    stock: {
      new: buildStock(newStock),
      used: buildStock(usedStock),
    },
    filters: {
      sellerCountries: sellerCountries,
      shippingCountries: shippingCountries,
      completeness: effectiveCompleteness,  // was gerade angezeigt wird (nur bei SETs)
    },
  });
}
