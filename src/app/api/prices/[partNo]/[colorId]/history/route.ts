import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { validatePartParams } from "@/lib/validate-params";
import { findPart } from "@/lib/find-part";
import { getCountryFilters } from "@/lib/user-settings";

export const dynamic = "force-dynamic";

export async function GET(
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

  const { searchParams } = new URL(request.url);
  const days = Math.min(
    Math.max(parseInt(searchParams.get("days") ?? "180") || 180, 1),
    365
  );

  const part = await findPart(partNo, colorId);
  if (!part) {
    return NextResponse.json({ error: "Part not found" }, { status: 404 });
  }

  const since = new Date();
  since.setDate(since.getDate() - days);

  // completeness-Filter für SETs (default 'C' wenn nicht gesetzt), NULL bei anderen
  const completenessParam = searchParams.get("completeness");
  const validCompl = completenessParam === "C" || completenessParam === "I" || completenessParam === "S" ? completenessParam : null;
  const isSet = part.itemType === "SET";
  const effectiveCompleteness = isSet ? (validCompl ?? "C") : null;

  const { shippingCountries, sellerCountries } = await getCountryFilters(userId);
  const queryParams: unknown[] = [part.id, since];
  let p = 3;
  let countryFilter = "";
  if (shippingCountries) { countryFilter += ` AND s.buyer_country = ANY($${p++})`; queryParams.push(shippingCountries); }
  if (sellerCountries)   { countryFilter += ` AND s.seller_country = ANY($${p++})`; queryParams.push(sellerCountries); }
  if (effectiveCompleteness) { countryFilter += ` AND s.completeness = $${p++}`; queryParams.push(effectiveCompleteness); }
  else                       { countryFilter += ` AND s.completeness IS NULL`; }

  interface DailyRow {
    day: Date;
    new_or_used: string;
    avg_price: number;
    min_price: number;
    max_price: number;
    qty_avg_price: number;
    unit_quantity: number;
    total_quantity: number;
  }

  const history = await prisma.$queryRawUnsafe<DailyRow[]>(
    `SELECT
      s.date_ordered::date as day,
      s.new_or_used,
      AVG(s.unit_price)::float as avg_price,
      MIN(s.unit_price)::float as min_price,
      MAX(s.unit_price)::float as max_price,
      (SUM(s.unit_price * s.quantity) / NULLIF(SUM(s.quantity), 0))::float as qty_avg_price,
      COUNT(*)::int as unit_quantity,
      COALESCE(SUM(s.quantity), 0)::int as total_quantity
    FROM price_sales s
    WHERE s.part_id = $1
      AND s.date_ordered >= $2
      ${countryFilter}
    GROUP BY s.date_ordered::date, s.new_or_used
    ORDER BY day ASC`,
    ...queryParams
  );

  const mapRow = (r: DailyRow) => ({
    fetchDate: r.day,
    newOrUsed: r.new_or_used,
    avgPrice: r.avg_price,
    minPrice: r.min_price,
    maxPrice: r.max_price,
    qtyAvgPrice: r.qty_avg_price,
    unitQuantity: r.unit_quantity,
    totalQuantity: r.total_quantity,
  });

  return NextResponse.json({
    partNo: part.partNo,
    colorId: part.colorId,
    days,
    new: history.filter(h => h.new_or_used === "N").map(mapRow),
    used: history.filter(h => h.new_or_used === "U").map(mapRow),
  });
}
