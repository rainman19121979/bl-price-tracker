import { prisma } from './db'
import { evaluateFormula, findMatchingRule, type PricingRule, type PricingVars } from './pricing-engine'
import { getCountryFilters } from './user-settings'

interface SoldStats {
  sold7d_median: number | null; sold30d_median: number | null
  sold60d_median: number | null; sold90d_median: number | null
  sold6m_median: number | null
  sold7d_avg: number | null; sold30d_avg: number | null
  sold60d_avg: number | null; sold90d_avg: number | null
  sold6m_avg: number | null
  sold6m_min: number | null; sold6m_max: number | null
  sold30d_count: number; sold90d_count: number; sold6m_count: number
  sold30d_qty: number; sold90d_qty: number; sold6m_qty: number
  recent_median: number | null
  previous_median: number | null
}

interface StockStats {
  stock_median: number | null; stock_avg: number | null
  stock_min: number | null; stock_max: number | null
  stock_count: number; stock_qty: number
}

function makeVars(s: SoldStats | undefined, st: StockStats | undefined, w: { my_price: number; my_quantity: number; my_cost: number }): PricingVars {
  return {
    sold7dMedian: s?.sold7d_median ?? 0, sold30dMedian: s?.sold30d_median ?? 0,
    sold60dMedian: s?.sold60d_median ?? 0, sold90dMedian: s?.sold90d_median ?? 0,
    sold6mMedian: s?.sold6m_median ?? 0,
    sold7dAvg: s?.sold7d_avg ?? 0, sold30dAvg: s?.sold30d_avg ?? 0,
    sold60dAvg: s?.sold60d_avg ?? 0, sold90dAvg: s?.sold90d_avg ?? 0,
    sold6mAvg: s?.sold6m_avg ?? 0,
    sold6mMin: s?.sold6m_min ?? 0, sold6mMax: s?.sold6m_max ?? 0,
    sold30dCount: s?.sold30d_count ?? 0, sold90dCount: s?.sold90d_count ?? 0, sold6mCount: s?.sold6m_count ?? 0,
    sold30dQty: s?.sold30d_qty ?? 0, sold90dQty: s?.sold90d_qty ?? 0, sold6mQty: s?.sold6m_qty ?? 0,
    stockMedian: st?.stock_median ?? 0, stockAvg: st?.stock_avg ?? 0,
    stockMin: st?.stock_min ?? 0, stockMax: st?.stock_max ?? 0,
    stockCount: st?.stock_count ?? 0, stockQty: st?.stock_qty ?? 0,
    myPrice: w.my_price, myQty: w.my_quantity, myCost: w.my_cost,
    soldMedian: s?.sold6m_median ?? 0, soldAvg: s?.sold6m_avg ?? 0,
  }
}

function computeTrend(recent: number | null, previous: number | null): string {
  if (recent == null || previous == null || previous === 0) return 'stable'
  const change = ((recent - previous) / previous) * 100
  if (change > 5) return 'up'
  if (change < -5) return 'down'
  return 'stable'
}

interface UserContext {
  rules: PricingRule[]
  shippingCountries: string[] | null
  sellerCountries: string[] | null
}

async function loadUserContext(userId: number): Promise<UserContext> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { pricingFormulas: true } })
  let rules: PricingRule[] = []
  if (user?.pricingFormulas) {
    try { rules = JSON.parse(user.pricingFormulas) } catch { /* ignore */ }
  }
  const { shippingCountries, sellerCountries } = await getCountryFilters(userId)
  return { rules, shippingCountries, sellerCountries }
}

async function fetchSoldStatsForParts(
  partIds: number[],
  shippingCountries: string[] | null,
  sellerCountries: string[] | null,
): Promise<Map<string, SoldStats>> {
  if (partIds.length === 0) return new Map()
  const d7 = new Date(Date.now() - 7 * 86400000)
  const d30 = new Date(Date.now() - 30 * 86400000)
  const d60 = new Date(Date.now() - 60 * 86400000)
  const d90 = new Date(Date.now() - 90 * 86400000)
  const sixMonthsAgo = new Date(); sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

  const params: unknown[] = [partIds, d7, d30, d60, d90, sixMonthsAgo]
  let p = 7
  let cf = ""
  if (shippingCountries) { cf += ` AND buyer_country = ANY($${p++})`; params.push(shippingCountries) }
  if (sellerCountries)   { cf += ` AND seller_country = ANY($${p++})`; params.push(sellerCountries) }

  const rows = await prisma.$queryRawUnsafe<Array<{ part_id: number; new_or_used: string; completeness: string | null } & SoldStats>>(
    `SELECT part_id, new_or_used, completeness,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unit_price) FILTER (WHERE date_ordered >= $2)::float as sold7d_median,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unit_price) FILTER (WHERE date_ordered >= $3)::float as sold30d_median,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unit_price) FILTER (WHERE date_ordered >= $4)::float as sold60d_median,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unit_price) FILTER (WHERE date_ordered >= $5)::float as sold90d_median,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unit_price)::float as sold6m_median,
      (SUM(unit_price * quantity) FILTER (WHERE date_ordered >= $2) / NULLIF(SUM(quantity) FILTER (WHERE date_ordered >= $2), 0))::float as sold7d_avg,
      (SUM(unit_price * quantity) FILTER (WHERE date_ordered >= $3) / NULLIF(SUM(quantity) FILTER (WHERE date_ordered >= $3), 0))::float as sold30d_avg,
      (SUM(unit_price * quantity) FILTER (WHERE date_ordered >= $4) / NULLIF(SUM(quantity) FILTER (WHERE date_ordered >= $4), 0))::float as sold60d_avg,
      (SUM(unit_price * quantity) FILTER (WHERE date_ordered >= $5) / NULLIF(SUM(quantity) FILTER (WHERE date_ordered >= $5), 0))::float as sold90d_avg,
      (SUM(unit_price * quantity) / NULLIF(SUM(quantity), 0))::float as sold6m_avg,
      MIN(unit_price)::float as sold6m_min, MAX(unit_price)::float as sold6m_max,
      COUNT(*) FILTER (WHERE date_ordered >= $3)::int as sold30d_count,
      COUNT(*) FILTER (WHERE date_ordered >= $5)::int as sold90d_count,
      COUNT(*)::int as sold6m_count,
      COALESCE(SUM(quantity) FILTER (WHERE date_ordered >= $3), 0)::int as sold30d_qty,
      COALESCE(SUM(quantity) FILTER (WHERE date_ordered >= $5), 0)::int as sold90d_qty,
      COALESCE(SUM(quantity), 0)::int as sold6m_qty,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unit_price) FILTER (WHERE date_ordered >= $3)::float as recent_median,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unit_price) FILTER (WHERE date_ordered >= $4 AND date_ordered < $3)::float as previous_median
    FROM price_sales
    WHERE part_id = ANY($1) AND date_ordered >= $6 ${cf}
    GROUP BY part_id, new_or_used, completeness`,
    ...params
  )

  // Key mit completeness — NULL wird zu "" damit Map-Key eindeutig ist
  const map = new Map<string, SoldStats>()
  for (const r of rows) map.set(`${r.part_id}:${r.new_or_used}:${r.completeness ?? ""}`, r)
  return map
}

async function fetchStockStatsForParts(
  partIds: number[],
  sellerCountries: string[] | null,
): Promise<Map<string, StockStats>> {
  if (partIds.length === 0) return new Map()
  const params: unknown[] = [partIds]
  const cf = sellerCountries ? (params.push(sellerCountries), " AND seller_country = ANY($2)") : ""

  const rows = await prisma.$queryRawUnsafe<Array<{ part_id: number; new_or_used: string; completeness: string | null } & StockStats>>(
    `WITH latest AS (
      SELECT DISTINCT ON (part_id, new_or_used, completeness) part_id, new_or_used, completeness, fetched_at
      FROM price_stock WHERE part_id = ANY($1) ${cf}
      ORDER BY part_id, new_or_used, completeness, fetched_at DESC
    )
    SELECT ps.part_id, ps.new_or_used, ps.completeness,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ps.unit_price)::float as stock_median,
      (SUM(ps.unit_price * ps.quantity) / NULLIF(SUM(ps.quantity), 0))::float as stock_avg,
      MIN(ps.unit_price)::float as stock_min, MAX(ps.unit_price)::float as stock_max,
      COUNT(*)::int as stock_count, COALESCE(SUM(ps.quantity), 0)::int as stock_qty
    FROM price_stock ps
    JOIN latest l ON ps.part_id = l.part_id AND ps.new_or_used = l.new_or_used
      AND ps.completeness IS NOT DISTINCT FROM l.completeness AND ps.fetched_at = l.fetched_at
    ${cf ? "WHERE ps.seller_country = ANY($2)" : ""}
    GROUP BY ps.part_id, ps.new_or_used, ps.completeness`,
    ...params
  )
  const map = new Map<string, StockStats>()
  for (const r of rows) map.set(`${r.part_id}:${r.new_or_used}:${r.completeness ?? ""}`, r)
  return map
}

interface WatchlistRow {
  id: number
  partId: number
  newOrUsed: string
  completeness: string | null
  myPrice: number
  myQuantity: number
  myCost: number
  itemType: string
  colorId: number
  categoryId: number | null
}

function computeOne(
  w: WatchlistRow,
  sold: SoldStats | undefined,
  stock: StockStats | undefined,
  rules: PricingRule[],
): { suggestedPrice: number | null; ruleName: string | null; trend: string; marketStockMedian: number | null; marketSoldMedian: number | null } {
  let suggestedPrice: number | null = null
  let ruleName: string | null = null

  if (rules.length > 0) {
    const rule = findMatchingRule(rules, {
      itemType: w.itemType, condition: w.newOrUsed,
      colorId: w.colorId, categoryId: w.categoryId,
    })
    if (rule) {
      const vars = makeVars(sold, stock, { my_price: w.myPrice, my_quantity: w.myQuantity, my_cost: w.myCost })
      const p = evaluateFormula(rule.formula, vars)
      if (p !== null) suggestedPrice = Math.round(p * 1000) / 1000
      ruleName = rule.name
    }
  }

  return {
    suggestedPrice,
    ruleName,
    trend: computeTrend(sold?.recent_median ?? null, sold?.previous_median ?? null),
    marketStockMedian: stock?.stock_median ?? null,
    marketSoldMedian: sold?.sold6m_median ?? null,
  }
}

/** Recompute pricing for a single Watchlist-Lot. */
export async function recomputeLotPricing(watchlistId: number): Promise<void> {
  const w = await prisma.userWatchlist.findUnique({
    where: { id: watchlistId },
    include: { part: { select: { id: true, itemType: true, colorId: true, categoryId: true } } },
  })
  if (!w) return

  const { rules, shippingCountries, sellerCountries } = await loadUserContext(w.userId)
  const partIds = [w.partId]

  const [soldStats, stockStats] = await Promise.all([
    fetchSoldStatsForParts(partIds, shippingCountries, sellerCountries),
    fetchStockStatsForParts(partIds, sellerCountries),
  ])

  const key = `${w.partId}:${w.newOrUsed}:${w.completeness ?? ""}`
  const row: WatchlistRow = {
    id: w.id, partId: w.partId, newOrUsed: w.newOrUsed, completeness: w.completeness,
    myPrice: w.myPrice ? Number(w.myPrice) : 0,
    myQuantity: w.myQuantity ?? 0,
    myCost: w.myCost ? Number(w.myCost) : 0,
    itemType: w.part.itemType, colorId: w.part.colorId,
    categoryId: w.part.categoryId ?? null,
  }
  const r = computeOne(row, soldStats.get(key), stockStats.get(key), rules)

  await prisma.userWatchlist.update({
    where: { id: watchlistId },
    data: {
      suggestedPrice: r.suggestedPrice,
      suggestedRuleName: r.ruleName,
      marketStockMedian: r.marketStockMedian,
      marketSoldMedian: r.marketSoldMedian,
      trend: r.trend,
      pricingComputedAt: new Date(),
    },
  })
}

/** Recompute all watchlist-lots that reference the given part+condition. */
export async function recomputeAllLotsForPart(partId: number, newOrUsed: 'N' | 'U'): Promise<void> {
  const lots = await prisma.userWatchlist.findMany({
    where: { partId, newOrUsed },
    include: { part: { select: { id: true, itemType: true, colorId: true, categoryId: true } } },
  })
  if (lots.length === 0) return

  // group by userId to honor per-user shipping countries / pricing formulas
  const byUser = new Map<number, typeof lots>()
  for (const l of lots) {
    const arr = byUser.get(l.userId) ?? []
    arr.push(l)
    byUser.set(l.userId, arr)
  }

  for (const [userId, userLots] of Array.from(byUser.entries())) {
    const { rules, shippingCountries, sellerCountries } = await loadUserContext(userId)
    const [soldStats, stockStats] = await Promise.all([
      fetchSoldStatsForParts([partId], shippingCountries, sellerCountries),
      fetchStockStatsForParts([partId], sellerCountries),
    ])
    for (const w of userLots) {
      const row: WatchlistRow = {
        id: w.id, partId: w.partId, newOrUsed: w.newOrUsed, completeness: w.completeness,
        myPrice: w.myPrice ? Number(w.myPrice) : 0,
        myQuantity: w.myQuantity ?? 0,
        myCost: w.myCost ? Number(w.myCost) : 0,
        itemType: w.part.itemType, colorId: w.part.colorId,
        categoryId: w.part.categoryId ?? null,
      }
      const key = `${w.partId}:${w.newOrUsed}:${w.completeness ?? ""}`
      const r = computeOne(row, soldStats.get(key), stockStats.get(key), rules)
      await prisma.userWatchlist.update({
        where: { id: w.id },
        data: {
          suggestedPrice: r.suggestedPrice,
          suggestedRuleName: r.ruleName,
          marketStockMedian: r.marketStockMedian,
          marketSoldMedian: r.marketSoldMedian,
          trend: r.trend,
          pricingComputedAt: new Date(),
        },
      })
    }
  }
}

/** Bulk recompute all lots for a user. Used for formula change / inventory sync / initial backfill. */
export async function recomputeAllLotsForUser(userId: number): Promise<{ updated: number }> {
  const lots = await prisma.userWatchlist.findMany({
    where: { userId },
    include: { part: { select: { id: true, itemType: true, colorId: true, categoryId: true } } },
  })
  if (lots.length === 0) return { updated: 0 }

  const { rules, shippingCountries, sellerCountries } = await loadUserContext(userId)
  const partIds = Array.from(new Set(lots.map(l => l.partId)))

  const [soldStats, stockStats] = await Promise.all([
    fetchSoldStatsForParts(partIds, shippingCountries, sellerCountries),
    fetchStockStatsForParts(partIds, sellerCountries),
  ])

  // Build per-lot results, then batch-update via UNNEST
  interface Result { id: number; suggestedPrice: number | null; ruleName: string | null; trend: string; marketStockMedian: number | null; marketSoldMedian: number | null }
  const results: Result[] = []
  for (const w of lots) {
    const key = `${w.partId}:${w.newOrUsed}:${w.completeness ?? ""}`
    const row: WatchlistRow = {
      id: w.id, partId: w.partId, newOrUsed: w.newOrUsed, completeness: w.completeness,
      myPrice: w.myPrice ? Number(w.myPrice) : 0,
      myQuantity: w.myQuantity ?? 0,
      myCost: w.myCost ? Number(w.myCost) : 0,
      itemType: w.part.itemType, colorId: w.part.colorId,
      categoryId: w.part.categoryId ?? null,
    }
    const r = computeOne(row, soldStats.get(key), stockStats.get(key), rules)
    results.push({ id: w.id, ...r })
  }

  // Batch update via UNNEST
  const ids = results.map(r => r.id)
  const sps = results.map(r => r.suggestedPrice)
  const rns = results.map(r => r.ruleName)
  const trs = results.map(r => r.trend)
  const msms = results.map(r => r.marketStockMedian)
  const msdms = results.map(r => r.marketSoldMedian)

  await prisma.$executeRawUnsafe(
    `UPDATE user_watchlists w SET
      suggested_price       = u.sp,
      suggested_rule_name   = u.rn,
      trend                 = u.tr,
      market_stock_median   = u.msm,
      market_sold_median    = u.msdm,
      pricing_computed_at   = NOW()
    FROM (
      SELECT * FROM unnest($1::int[], $2::decimal[], $3::text[], $4::text[], $5::decimal[], $6::decimal[])
        AS t(id, sp, rn, tr, msm, msdm)
    ) u
    WHERE w.id = u.id`,
    ids, sps, rns, trs, msms, msdms
  )

  return { updated: results.length }
}
