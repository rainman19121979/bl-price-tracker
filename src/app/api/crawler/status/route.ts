import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getUsage } from "@/lib/api-usage";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = parseInt(session.user.id);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    apiKey,
    partsTotal,
    partsWithPrice,
    partsNeedUpdate,
    doneToday,
    recentlyUpdated,
  ] = await Promise.all([
    prisma.userApiKey.findFirst({
      where: { userId, isValid: true },
      select: { id: true, dailyLimit: true },
    }),
    // Unique parts in user's watchlist
    prisma.$queryRawUnsafe<[{ count: number }]>(
      `SELECT COUNT(DISTINCT part_id)::int as count FROM user_watchlists WHERE user_id = $1`,
      userId
    ),
    // Parts with any price data
    prisma.part.count({ where: { lastPriceUpdate: { not: null } } }),
    // Parts that need updating (no price or > 7 days)
    prisma.$queryRawUnsafe<[{ count: number }]>(
      `SELECT COUNT(DISTINCT w.part_id)::int as count
       FROM user_watchlists w
       JOIN parts p ON p.id = w.part_id
       WHERE w.user_id = $1
       AND (p.last_price_update IS NULL OR p.last_price_update < $2)`,
      userId,
      sevenDaysAgo
    ),
    // Parts updated today
    prisma.part.count({
      where: {
        lastPriceUpdate: { gte: today },
        watchlists: { some: { userId } },
      },
    }),
    // Last 20 updated parts using condition-specific timestamps
    prisma.$queryRawUnsafe<Array<{
      part_no: string; color_id: number; color_name: string | null;
      part_name: string | null; item_type: string; new_or_used: string;
      last_crawl: Date | null;
    }>>(
      `SELECT p.part_no, p.color_id, p.color_name, p.part_name, p.item_type,
        w.new_or_used,
        GREATEST(
          CASE WHEN w.new_or_used = 'N' THEN p.last_sold_crawl_n ELSE p.last_sold_crawl_u END,
          CASE WHEN w.new_or_used = 'N' THEN p.last_stock_crawl_n ELSE p.last_stock_crawl_u END
        ) as last_crawl
      FROM user_watchlists w
      JOIN parts p ON p.id = w.part_id
      WHERE w.user_id = $1 AND (
        CASE WHEN w.new_or_used = 'N' THEN p.last_sold_crawl_n ELSE p.last_sold_crawl_u END IS NOT NULL
        OR CASE WHEN w.new_or_used = 'N' THEN p.last_stock_crawl_n ELSE p.last_stock_crawl_u END IS NOT NULL
      )
      ORDER BY last_crawl DESC NULLS LAST
      LIMIT 20`,
      userId
    ),
  ]);

  return NextResponse.json({
    apiToday: apiKey ? await getUsage(apiKey.id) : 0,
    apiLimit: apiKey?.dailyLimit ?? 0,
    partsTotal: partsTotal[0]?.count ?? 0,
    partsWithPrice,
    partsNeedUpdate: partsNeedUpdate[0]?.count ?? 0,
    doneToday,
    recentlyUpdated: recentlyUpdated.map((p) => ({
      partNo: p.part_no,
      colorId: p.color_id,
      colorName: p.color_name,
      partName: p.part_name,
      itemType: p.item_type,
      newOrUsed: p.new_or_used,
      updatedAt: p.last_crawl,
    })),
  });
}
