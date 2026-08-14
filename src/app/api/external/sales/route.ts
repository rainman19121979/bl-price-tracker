import { NextRequest, NextResponse } from "next/server";
import { authenticateBearer, enforceExternalRateLimit, getApiUsageFor } from "@/lib/external-price";
import { prisma } from "@/lib/db";

const MAX_LIMIT = 500;

interface Row {
  id: number; sold_at: string; platform: string; order_id: string;
  part_no: string; color_id: number; color_name: string | null;
  item_type: string; new_or_used: string;
  quantity: number; unit_price: number;
}

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await authenticateBearer(request);
  if (!auth) return NextResponse.json({ error: "Bearer token required or invalid" }, { status: 401 });
  const _rl = await enforceExternalRateLimit(auth.tokenId); if (_rl) return _rl;

  const { searchParams } = new URL(request.url);
  const platform = searchParams.get("platform");
  const sinceParam = searchParams.get("since");
  const untilParam = searchParams.get("until");
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get("limit") ?? "100")));
  const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0"));

  const platformFilter = platform === "BL" || platform === "BO" ? platform : null;
  const since = sinceParam ? new Date(sinceParam) : null;
  const until = untilParam ? new Date(untilParam) : null;
  if (since && isNaN(since.getTime())) return NextResponse.json({ error: "since must be YYYY-MM-DD" }, { status: 400 });
  if (until && isNaN(until.getTime())) return NextResponse.json({ error: "until must be YYYY-MM-DD" }, { status: 400 });

  const cond: string[] = ["ms.user_id = $1"];
  const params: unknown[] = [auth.userId];
  let p = 2;
  if (platformFilter) { cond.push(`ms.platform = $${p++}`); params.push(platformFilter); }
  if (since) { cond.push(`ms.sold_at >= $${p++}`); params.push(since); }
  if (until) { cond.push(`ms.sold_at < $${p++}`); params.push(until); }
  const where = cond.join(" AND ");

  const [rows, count] = await Promise.all([
    prisma.$queryRawUnsafe<Row[]>(
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
      `SELECT COUNT(*)::int as count FROM my_sales ms WHERE ${where}`,
      ...params,
    ),
  ]);

  return NextResponse.json({
    count: count[0].count,
    limit,
    offset,
    sales: rows.map(r => ({
      id: r.id,
      soldAt: r.sold_at,
      platform: r.platform,
      orderId: r.order_id,
      partNo: r.part_no,
      colorId: r.color_id,
      colorName: r.color_name,
      itemType: r.item_type,
      condition: r.new_or_used,
      quantity: r.quantity,
      unitPrice: r.unit_price,
    })),
    apiUsage: await getApiUsageFor(auth.userId),
  });
}
