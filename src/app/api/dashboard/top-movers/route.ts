import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(today.getDate() - 7);

  // Get all parts that have price data both today-ish (latest) and ~7 days ago
  // We use raw SQL for this aggregation query for performance
  const movers = await prisma.$queryRaw<
    Array<{
      part_id: number;
      part_no: string;
      color_id: number;
      part_name: string | null;
      color_name: string | null;
      image_url: string | null;
      new_or_used: string;
      latest_avg: number;
      older_avg: number;
      price_change: number;
      pct_change: number;
    }>
  >`
    WITH latest_prices AS (
      SELECT DISTINCT ON (part_id, new_or_used)
        part_id, new_or_used, avg_price, fetch_date
      FROM price_daily
      WHERE fetch_date >= ${sevenDaysAgo}::date
      ORDER BY part_id, new_or_used, fetch_date DESC
    ),
    older_prices AS (
      SELECT DISTINCT ON (part_id, new_or_used)
        part_id, new_or_used, avg_price, fetch_date
      FROM price_daily
      WHERE fetch_date <= ${sevenDaysAgo}::date
      ORDER BY part_id, new_or_used, fetch_date DESC
    )
    SELECT
      l.part_id,
      p.part_no,
      p.color_id,
      p.part_name,
      p.color_name,
      p.image_url,
      l.new_or_used,
      l.avg_price::float AS latest_avg,
      o.avg_price::float AS older_avg,
      (l.avg_price - o.avg_price)::float AS price_change,
      CASE WHEN o.avg_price > 0
        THEN ((l.avg_price - o.avg_price) / o.avg_price * 100)::float
        ELSE 0
      END AS pct_change
    FROM latest_prices l
    JOIN older_prices o ON l.part_id = o.part_id AND l.new_or_used = o.new_or_used
    JOIN parts p ON p.id = l.part_id
    WHERE l.avg_price IS NOT NULL AND o.avg_price IS NOT NULL
    ORDER BY (l.avg_price - o.avg_price)::float DESC
  `;

  // Split into increases and decreases
  const increases = movers
    .filter((m) => m.price_change > 0)
    .slice(0, 10)
    .map(formatMover);

  const decreases = movers
    .filter((m) => m.price_change < 0)
    .sort((a, b) => a.price_change - b.price_change)
    .slice(0, 10)
    .map(formatMover);

  return NextResponse.json({ increases, decreases });
}

function formatMover(m: {
  part_id: number;
  part_no: string;
  color_id: number;
  part_name: string | null;
  color_name: string | null;
  image_url: string | null;
  new_or_used: string;
  latest_avg: number;
  older_avg: number;
  price_change: number;
  pct_change: number;
}) {
  return {
    partId: m.part_id,
    partNo: m.part_no,
    colorId: m.color_id,
    partName: m.part_name,
    colorName: m.color_name,
    imageUrl: m.image_url,
    newOrUsed: m.new_or_used,
    latestAvg: m.latest_avg,
    olderAvg: m.older_avg,
    priceChange: m.price_change,
    pctChange: m.pct_change,
  };
}
