import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

interface KpiRow { revenue: number; qty: number; orders: number; itemLines: number }
interface MonthlyRow { ym: string; revenue: number; qty: number; orders: number }
interface TopPartRow {
  part_no: string; color_id: number; color_name: string | null;
  item_type: string; new_or_used: string;
  qty: number; revenue: number; orders: number;
}
interface SaleRow {
  id: number; sold_at: string; platform: string; order_id: string;
  part_no: string; color_id: number; color_name: string | null;
  item_type: string; new_or_used: string;
  quantity: number; unit_price: number;
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = parseInt(session.user.id);

  const { searchParams } = new URL(request.url);
  const platform = searchParams.get("platform"); // BL | BO | null
  const sinceParam = searchParams.get("since");   // YYYY-MM-DD
  const untilParam = searchParams.get("until");
  const search = searchParams.get("search")?.trim() || null; // partNo or color-name
  const limit = Math.min(500, Math.max(1, parseInt(searchParams.get("limit") ?? "100")));
  const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0"));

  const platformFilter = platform === "BL" || platform === "BO" ? platform : null;
  const since = sinceParam ? new Date(sinceParam) : null;
  const until = untilParam ? new Date(untilParam) : null;

  // Build shared WHERE
  const cond: string[] = ["ms.user_id = $1"];
  const params: unknown[] = [userId];
  let p = 2;
  if (platformFilter) { cond.push(`ms.platform = $${p++}`); params.push(platformFilter); }
  if (since) { cond.push(`ms.sold_at >= $${p++}`); params.push(since); }
  if (until) { cond.push(`ms.sold_at < $${p++}`); params.push(until); }
  if (search) {
    cond.push(`(p.part_no ILIKE $${p} OR p.color_name ILIKE $${p})`);
    params.push(`%${search}%`); p++;
  }
  const where = cond.join(" AND ");

  const [kpiOverall, kpi30, kpi90, kpi180, monthly, topParts, listRows, totalCount] = await Promise.all([
    prisma.$queryRawUnsafe<KpiRow[]>(
      `SELECT COALESCE(SUM(ms.unit_price::float * ms.quantity), 0)::float as revenue,
              COALESCE(SUM(ms.quantity), 0)::int as qty,
              COUNT(DISTINCT ms.order_id)::int as orders,
              COUNT(*)::int as "itemLines"
       FROM my_sales ms JOIN parts p ON p.id = ms.part_id
       WHERE ${where}`,
      ...params,
    ),
    prisma.$queryRawUnsafe<KpiRow[]>(
      `SELECT COALESCE(SUM(ms.unit_price::float * ms.quantity), 0)::float as revenue,
              COALESCE(SUM(ms.quantity), 0)::int as qty,
              COUNT(DISTINCT ms.order_id)::int as orders,
              COUNT(*)::int as "itemLines"
       FROM my_sales ms JOIN parts p ON p.id = ms.part_id
       WHERE ${where} AND ms.sold_at >= NOW() - INTERVAL '30 days'`,
      ...params,
    ),
    prisma.$queryRawUnsafe<KpiRow[]>(
      `SELECT COALESCE(SUM(ms.unit_price::float * ms.quantity), 0)::float as revenue,
              COALESCE(SUM(ms.quantity), 0)::int as qty,
              COUNT(DISTINCT ms.order_id)::int as orders,
              COUNT(*)::int as "itemLines"
       FROM my_sales ms JOIN parts p ON p.id = ms.part_id
       WHERE ${where} AND ms.sold_at >= NOW() - INTERVAL '90 days'`,
      ...params,
    ),
    prisma.$queryRawUnsafe<KpiRow[]>(
      `SELECT COALESCE(SUM(ms.unit_price::float * ms.quantity), 0)::float as revenue,
              COALESCE(SUM(ms.quantity), 0)::int as qty,
              COUNT(DISTINCT ms.order_id)::int as orders,
              COUNT(*)::int as "itemLines"
       FROM my_sales ms JOIN parts p ON p.id = ms.part_id
       WHERE ${where} AND ms.sold_at >= NOW() - INTERVAL '180 days'`,
      ...params,
    ),
    prisma.$queryRawUnsafe<MonthlyRow[]>(
      `SELECT TO_CHAR(ms.sold_at, 'YYYY-MM') as ym,
              ROUND(SUM(ms.unit_price::float * ms.quantity)::numeric, 2)::float as revenue,
              SUM(ms.quantity)::int as qty,
              COUNT(DISTINCT ms.order_id)::int as orders
       FROM my_sales ms JOIN parts p ON p.id = ms.part_id
       WHERE ${where} AND ms.sold_at >= NOW() - INTERVAL '12 months'
       GROUP BY ym ORDER BY ym`,
      ...params,
    ),
    prisma.$queryRawUnsafe<TopPartRow[]>(
      `SELECT p.part_no, p.color_id, p.color_name, p.item_type, ms.new_or_used,
              SUM(ms.quantity)::int as qty,
              ROUND(SUM(ms.unit_price::float * ms.quantity)::numeric, 2)::float as revenue,
              COUNT(DISTINCT ms.order_id)::int as orders
       FROM my_sales ms JOIN parts p ON p.id = ms.part_id
       WHERE ${where}
       GROUP BY p.part_no, p.color_id, p.color_name, p.item_type, ms.new_or_used
       ORDER BY qty DESC LIMIT 10`,
      ...params,
    ),
    prisma.$queryRawUnsafe<SaleRow[]>(
      `SELECT ms.id, ms.sold_at, ms.platform, ms.order_id,
              p.part_no, p.color_id, p.color_name, p.item_type, ms.new_or_used,
              ms.quantity, ms.unit_price::float as unit_price
       FROM my_sales ms JOIN parts p ON p.id = ms.part_id
       WHERE ${where}
       ORDER BY ms.sold_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      ...params,
    ),
    prisma.$queryRawUnsafe<[{count: number}]>(
      `SELECT COUNT(*)::int as count
       FROM my_sales ms JOIN parts p ON p.id = ms.part_id
       WHERE ${where}`,
      ...params,
    ),
  ]);

  return NextResponse.json({
    kpi: {
      overall: kpiOverall[0],
      d30: kpi30[0],
      d90: kpi90[0],
      d180: kpi180[0],
    },
    monthly,
    topParts,
    sales: listRows,
    pagination: {
      total: totalCount[0].count,
      limit,
      offset,
    },
  });
}
