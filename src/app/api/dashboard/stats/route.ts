import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getUsageForKeys, getExternalCallCount } from "@/lib/api-usage";
import { getCountryFilters } from "@/lib/user-settings";

export const dynamic = "force-dynamic";

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

  // Missstand-Klassifikation (priority-basiert, jeder Lot faellt in genau
  // EINEN Bucket -- damit die Summe der Buckets exakt dem Total entspricht,
  // ohne Doppelzaehlung).
  //
  // Prioritaets-Reihenfolge:
  //   1. neu             -> nie gecrawlt (weder sold noch stock)
  //   2. countryMismatch -> User hat sellerCountries gesetzt, aber die
  //                          neueste price_stock-Snapshot enthaelt nur 'XX'-
  //                          Zeilen (weltweit-Fallback, kein Country-Crawl
  //                          vorhanden fuer den gesetzten Country).
  //   3. staleCache      -> pricingComputedAt > 2*freshDays alt
  //   4. staleData       -> latest_ts alt (die urspruengliche Definition)
  //
  // Ein neu-Lot faellt NUR in "neu", nicht auch in "countryMismatch" oder
  // "staleCache" -- weil ohne Daten kann per definitionem kein Country-
  // Missmatch/staler Cache vorliegen.
  const { sellerCountries } = await getCountryFilters(userId);
  const twoFreshDaysAgo = new Date(Date.now() - 2 * freshDays * 24 * 60 * 60 * 1000);

  interface BreakdownRow {
    new_count: number
    country_mismatch_count: number
    stale_cache_count: number
    stale_data_count: number
    total_needs: number
  }

  // Wenn User keine sellerCountries hat, gibt es per definition keinen
  // country_mismatch -- die Query berechnet den dann als 0.
  const hasSellerFilter = sellerCountries !== null && sellerCountries.length > 0
  const sellerParam = hasSellerFilter ? sellerCountries : null

  const breakdown = await prisma.$queryRawUnsafe<BreakdownRow[]>(
    `WITH lot_state AS (
      SELECT
        w.id,
        (${soldTsExpr} IS NULL AND ${stockTsExpr} IS NULL) AS is_new,
        (
          $3::text[] IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM price_stock ps
            WHERE ps.part_id = w.part_id
              AND ps.new_or_used = w.new_or_used
              AND ps.completeness IS NOT DISTINCT FROM w.completeness
              AND ps.fetched_at = (
                SELECT MAX(fetched_at) FROM price_stock
                WHERE part_id = w.part_id AND new_or_used = w.new_or_used
              )
            GROUP BY ps.part_id
            HAVING NOT bool_or(ps.seller_country = ANY($3::text[]))
          )
        ) AS is_country_mismatch,
        (w.pricing_computed_at IS NULL OR w.pricing_computed_at < $4) AS is_stale_cache,
        (${latestTsExpr} IS NULL OR ${latestTsExpr} < $2) AS is_stale_data
      FROM user_watchlists w JOIN parts p ON p.id = w.part_id
      WHERE w.user_id = $1
    )
    SELECT
      COUNT(*) FILTER (WHERE is_new)::int AS new_count,
      COUNT(*) FILTER (WHERE NOT is_new AND is_country_mismatch)::int AS country_mismatch_count,
      COUNT(*) FILTER (WHERE NOT is_new AND NOT is_country_mismatch AND is_stale_cache)::int AS stale_cache_count,
      COUNT(*) FILTER (WHERE NOT is_new AND NOT is_country_mismatch AND NOT is_stale_cache AND is_stale_data)::int AS stale_data_count,
      COUNT(*) FILTER (WHERE is_new OR is_country_mismatch OR is_stale_cache OR is_stale_data)::int AS total_needs
    FROM lot_state`,
    userId, freshThreshold, sellerParam, twoFreshDaysAgo,
  );
  const b = breakdown[0];

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

  // Boost-Berechnung fuer Missstand-Priorisierung (spiegelt die Logik in
  // src/workers/crawler.ts:calculateDelay). 20% Reserve fuer Spikes.
  // Nur relevant wenn Country-Mismatches existieren.
  let boostCallsPerDay = 0;
  if (b.country_mismatch_count > 0) {
    const freeAfterMaintenance = Math.max(
      0, dailyLimit - externalCallsPerDay - maintenanceCallsPerDay
    );
    const boostBudget = Math.floor(freeAfterMaintenance * 0.80);
    boostCallsPerDay = Math.min(boostBudget, b.country_mismatch_count * 2);
  }

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
    boostCallsPerDay,
    etaDays,
    callsPerDay24h,
    partsWithPrice: watchlistCount - partsNeedUpdate,
    partsNeedUpdate,
    doneTodaySold,
    doneTodayStock,
    // Priority-basierte Aufschluesselung: jedes Lot faellt in genau EINEN
    // Bucket. Sum(needsUpdateBreakdown) === needsUpdateTotal.
    needsUpdateBreakdown: {
      neu: b.new_count,
      countryMismatch: b.country_mismatch_count,
      staleCache: b.stale_cache_count,
      staleData: b.stale_data_count,
    },
    needsUpdateTotal: b.total_needs,
    hasSellerCountryFilter: hasSellerFilter,
  });
}
