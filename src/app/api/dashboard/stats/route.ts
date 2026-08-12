import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getUsageForKeys, getExternalCallCount } from "@/lib/api-usage";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = parseInt(session.user.id);

  // Get user's freshDays setting
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { freshDays: true } });
  const freshDays = user?.freshDays ?? 14;
  const freshThreshold = new Date(Date.now() - freshDays * 24 * 60 * 60 * 1000);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Use condition-specific timestamps — GREATEST of sold+stock for freshness
  const soldTsExpr = "CASE WHEN w.new_or_used = 'N' THEN p.last_sold_crawl_n ELSE p.last_sold_crawl_u END";
  const stockTsExpr = "CASE WHEN w.new_or_used = 'N' THEN p.last_stock_crawl_n ELSE p.last_stock_crawl_u END";
  // Latest of sold/stock per condition — a part is "fresh" if either was crawled recently
  const latestTsExpr = `GREATEST(${soldTsExpr}, ${stockTsExpr})`;

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [
    watchlistCount,
    withoutPriceResult,
    freshPriceResult,
    stalePriceResult,
    apiKeys,
    doneTodaySoldResult,
    doneTodayStockResult,
  ] = await Promise.all([
    prisma.userWatchlist.count({ where: { userId } }),
    prisma.$queryRawUnsafe<[{count: number}]>(
      `SELECT COUNT(*)::int as count FROM user_watchlists w JOIN parts p ON p.id = w.part_id
       WHERE w.user_id = $1 AND ${soldTsExpr} IS NULL AND ${stockTsExpr} IS NULL`, userId),
    prisma.$queryRawUnsafe<[{count: number}]>(
      `SELECT COUNT(*)::int as count FROM user_watchlists w JOIN parts p ON p.id = w.part_id
       WHERE w.user_id = $1 AND ${latestTsExpr} >= $2`, userId, freshThreshold),
    prisma.$queryRawUnsafe<[{count: number}]>(
      `SELECT COUNT(*)::int as count FROM user_watchlists w JOIN parts p ON p.id = w.part_id
       WHERE w.user_id = $1 AND ${latestTsExpr} IS NOT NULL AND ${latestTsExpr} < $2
       AND NOT (${soldTsExpr} IS NULL AND ${stockTsExpr} IS NULL)`, userId, freshThreshold),
    prisma.userApiKey.findMany({ where: { userId }, select: { id: true, dailyLimit: true, externalCalls: true } }),
    prisma.$queryRawUnsafe<[{count: number}]>(
      `SELECT COUNT(*)::int as count FROM user_watchlists w JOIN parts p ON p.id = w.part_id
       WHERE w.user_id = $1 AND ${soldTsExpr} >= $2`, userId, oneDayAgo),
    prisma.$queryRawUnsafe<[{count: number}]>(
      `SELECT COUNT(*)::int as count FROM user_watchlists w JOIN parts p ON p.id = w.part_id
       WHERE w.user_id = $1 AND ${stockTsExpr} >= $2`, userId, oneDayAgo),
  ]);

  const withoutPrice = withoutPriceResult[0].count;
  const freshPrice = freshPriceResult[0].count;
  const stalePrice = stalePriceResult[0].count;
  const doneTodaySold = doneTodaySoldResult[0].count;
  const doneTodayStock = doneTodayStockResult[0].count;

  const requestsToday = await getUsageForKeys(apiKeys.map(k => k.id));
  const dailyLimit = apiKeys.reduce((s, k) => s + k.dailyLimit, 0);
  const partsNeedUpdate = withoutPrice + stalePrice;

  // Estimated external calls (from per-key externalCalls JSON settings)
  const externalCallsPerDay = await getExternalCallCount(userId);

  // Estimated cycle (full speed): lots × 2 (sold+stock) / available daily calls
  const availableCalls = Math.max(1, dailyLimit - externalCallsPerDay);
  const estimatedCycleDays = Math.ceil((watchlistCount * 2) / availableCalls);

  // Maintenance mode cycle: lots × 2 / freshDays calls per day
  const maintenanceCallsPerDay = Math.ceil((watchlistCount * 2) / freshDays);

  // ETA: how long until remaining parts are crawled at current rate?
  const callsNeeded = partsNeedUpdate * 2; // sold + stock per lot
  // Current rate: how many calls in last hour → extrapolate
  const oneHourAgo = new Date(Date.now() - 3600000);
  const callsLastHour = await prisma.apiCallLog.count({ where: { createdAt: { gte: oneHourAgo } } });
  const callsPerDay24h = callsLastHour * 24;
  const etaDays = callsPerDay24h > 0 ? Math.ceil(callsNeeded / callsPerDay24h) : 0;

  return NextResponse.json({
    watchlistCount,
    withoutPrice,
    freshPrice,
    stalePrice,
    requestsToday,
    dailyLimit,
    externalCallsPerDay,
    freshDays,
    estimatedCycleDays,
    maintenanceCallsPerDay,
    etaDays,
    callsPerDay24h,
    partsWithPrice: watchlistCount - partsNeedUpdate,
    partsNeedUpdate,
    doneTodaySold,
    doneTodayStock,
  });
}
