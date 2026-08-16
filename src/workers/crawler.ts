import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/encryption'
import { BrickLinkClient, BrickLinkApiError } from '@/lib/bricklink-api'
import { logApiCall, getUsageByKey, getExternalCallCount } from '@/lib/api-usage'
import { redis } from '@/lib/redis'
import { recomputeAllLotsForPart } from '@/lib/lot-pricing'
import { getCountryFilters } from '@/lib/user-settings'

const MIN_DELAY_MS = 2000

// ---------------------------------------------------------------------------
// Calculate delay: spread total daily budget evenly over remaining day
// ---------------------------------------------------------------------------

/**
 * Ermittelt ob es fuer einen User "Missstaende" gibt (Country-Mismatch:
 * neueste price_stock-Snapshot enthaelt nur 'XX'-Zeilen, aber User hat
 * sellerCountries gesetzt). Diese werden priorisiert abgearbeitet mit
 * dem Budget das nach Maintenance + Reserve uebrig ist.
 * Return: Anzahl solcher Lots pro User.
 */
async function countCountryMismatches(userId: number, sellerCountries: string[]): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<[{ count: number }]>(
    `SELECT COUNT(*)::int as count
     FROM user_watchlists w JOIN parts p ON p.id = w.part_id
     WHERE w.user_id = $1
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
         HAVING NOT bool_or(ps.seller_country = ANY($2::text[]))
       )`,
    userId, sellerCountries,
  )
  return rows[0]?.count ?? 0
}

async function calculateDelay(): Promise<number> {
  const keys = await prisma.userApiKey.findMany({
    where: { isValid: true, user: { crawlerEnabled: true } },
    select: { id: true, dailyLimit: true, userId: true },
  })

  const usageMap = await getUsageByKey(keys.map(k => k.id))
  const uniqueUserIds = Array.from(new Set(keys.map(k => k.userId)))
  const externalCalls = (await Promise.all(uniqueUserIds.map(uid => getExternalCallCount(uid))))
    .reduce((s, n) => s + n, 0)
  const ourUsage = keys.reduce((sum, k) => sum + (usageMap.get(k.id) ?? 0), 0)
  const totalLimit = keys.reduce((sum, k) => sum + k.dailyLimit, 0)
  const totalRemaining = Math.max(0, totalLimit - ourUsage - externalCalls)

  if (totalRemaining <= 0) return 0

  // Check if there are parts without any data (new parts)
  const userIds = uniqueUserIds
  let hasNewParts = false
  for (const uid of userIds) {
    const count = await prisma.$queryRawUnsafe<[{ count: number }]>(
      `SELECT COUNT(*)::int as count FROM user_watchlists w JOIN parts p ON p.id = w.part_id
       WHERE w.user_id = $1 AND (
         (w.new_or_used = 'N' AND p.last_sold_crawl_n IS NULL)
         OR (w.new_or_used = 'U' AND p.last_sold_crawl_u IS NULL)
       )`, uid
    )
    if (count[0].count > 0) { hasNewParts = true; break }
  }

  if (hasNewParts) {
    // Full speed: spread dailyLimit evenly over 24h
    const availableBudget = Math.max(1, totalLimit - externalCalls)
    return Math.max(MIN_DELAY_MS, Math.round((86400 / availableBudget) * 1000))
  }

  // Maintenance mode: spread evenly over freshDays
  // Non-SET-Lots × 2 (sold+stock) + SET-Lots × 6 (sold+stock × C/I/S) = calls/cycle
  const user = await prisma.user.findFirst({ where: { id: { in: userIds } }, select: { freshDays: true } })
  const freshDays = user?.freshDays ?? 14
  const [setLots, nonSetLots] = await Promise.all([
    prisma.userWatchlist.count({ where: { userId: { in: userIds }, part: { itemType: 'SET' } } }),
    prisma.userWatchlist.count({ where: { userId: { in: userIds }, part: { itemType: { not: 'SET' } } } }),
  ])
  const maintenanceCallsPerDay = Math.ceil((nonSetLots * 2 + setLots * 6) / freshDays)

  // Zusatz-Budget fuer Missstaende: 80% des Rests nach Maintenance + externem
  // Verbrauch (20% Reserve fuer Spikes / manuelle Refreshs / BrickSync-Peaks).
  let missstandCallsPerDay = 0
  for (const uid of userIds) {
    const { sellerCountries } = await getCountryFilters(uid)
    if (!sellerCountries || sellerCountries.length === 0) continue
    const missCount = await countCountryMismatches(uid, sellerCountries)
    if (missCount === 0) continue
    // Freies Budget nach Maintenance (best-effort Schaetzung pro Tag)
    const freeAfterMaintenance = Math.max(0, totalLimit - externalCalls - maintenanceCallsPerDay)
    const boostBudget = Math.floor(freeAfterMaintenance * 0.80)
    // Nicht mehr Calls einplanen als Missstaende existieren (× 1 Stock-Call
    // pro Missstand; bei SETs × 3 wegen C/I/S -- konservativ mit ×2 rechnen)
    missstandCallsPerDay = Math.min(boostBudget, missCount * 2)
    break  // fuer Solo-Instanz reicht der erste User; bei Multi-User addiert
  }

  const totalCallsPerDay = maintenanceCallsPerDay + missstandCallsPerDay
  const delay = Math.round((86400 / Math.max(1, totalCallsPerDay)) * 1000)

  const boostLabel = missstandCallsPerDay > 0
    ? ` + ${missstandCallsPerDay} Boost (Missstaende)` : ''
  console.log(`[Crawler] Erhaltungsmodus: ${maintenanceCallsPerDay} Calls/Tag${boostLabel} fuer ${nonSetLots} Parts/Minifigs + ${setLots} SETs (×3 wg. C/I/S) in ${freshDays} Tagen`)
  return Math.max(MIN_DELAY_MS, delay)
}

// ---------------------------------------------------------------------------
// Find next job: alternates between sold and stock
// - sold: lastPriceUpdate null or > 7 days
// - stock: lastStockUpdate null or > 7 days
// Always picks the one with the oldest/null timestamp
// ---------------------------------------------------------------------------

type JobType = 'sold' | 'stock'

interface NextJob {
  type: JobType
  partId: number
  partNo: string
  colorId: number
  itemType: string
  newOrUsed: 'N' | 'U'
  userId: number
  apiKeyId: number
  consumerKey: string
  consumerSecretEnc: Buffer
  tokenValue: string
  tokenSecretEnc: Buffer
}

async function findNextJob(): Promise<NextJob | null> {
  // Only use keys from users who have crawler enabled
  const allKeys = await prisma.userApiKey.findMany({
    where: {
      isValid: true,
      user: { crawlerEnabled: true },
    },
    select: {
      id: true, userId: true, dailyLimit: true,
      consumerKey: true, consumerSecretEnc: true, tokenValue: true, tokenSecretEnc: true,
    },
  })

  const usageMap = await getUsageByKey(allKeys.map(k => k.id))
  const validKeys = allKeys.filter(k => (usageMap.get(k.id) ?? 0) < k.dailyLimit)
  if (validKeys.length === 0) return null

  for (const key of validKeys) {
    // Priority: recently changed items first (e.g. after sale)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    const priorityItem = await prisma.userWatchlist.findFirst({
      where: { userId: key.userId, changedAt: { gte: oneHourAgo } },
      include: {
        part: { select: { id: true, partNo: true, colorId: true, itemType: true, lastPriceUpdate: true, lastStockUpdate: true } },
      },
      orderBy: { changedAt: 'asc' },
    })

    if (priorityItem) {
      const lastType = await redis.get('crawler:lastType')
      const type: JobType = lastType === 'sold' ? 'stock' : 'sold'
      return {
        type,
        partId: priorityItem.part.id,
        partNo: priorityItem.part.partNo,
        colorId: priorityItem.part.colorId,
        itemType: priorityItem.part.itemType,
        newOrUsed: priorityItem.newOrUsed as 'N' | 'U',
        userId: key.userId,
        apiKeyId: key.id,
        consumerKey: key.consumerKey,
        consumerSecretEnc: Buffer.from(key.consumerSecretEnc),
        tokenValue: key.tokenValue,
        tokenSecretEnc: Buffer.from(key.tokenSecretEnc),
      }
    }

    // Prioritaet 2: Country-Mismatch. Wenn User sellerCountries hat und
    // ein Lot dessen neueste price_stock-Snapshot NUR 'XX'-Zeilen enthaelt,
    // soll dieser Stock (nicht Sold) priorisiert gecrawlt werden -- die
    // Sold-Daten haben per-Entry country und sind unabhaengig ok.
    // Nur ausfuehren wenn nach Maintenance noch Budget da ist (siehe
    // calculateDelay -- der Delay-Wert bestimmt das Tempo, hier waehlen
    // wir nur den naechsten Job aus).
    const { sellerCountries: userSellerCountries } = await getCountryFilters(key.userId)
    if (userSellerCountries && userSellerCountries.length > 0) {
      const missstand = await prisma.$queryRawUnsafe<Array<{
        part_id: number; part_no: string; color_id: number;
        item_type: string; new_or_used: string;
      }>>(
        `SELECT p.id as part_id, p.part_no, p.color_id, p.item_type, w.new_or_used
         FROM user_watchlists w JOIN parts p ON p.id = w.part_id
         WHERE w.user_id = $1
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
             HAVING NOT bool_or(ps.seller_country = ANY($2::text[]))
           )
         ORDER BY CASE WHEN w.new_or_used='N' THEN p.last_stock_crawl_n ELSE p.last_stock_crawl_u END ASC NULLS FIRST
         LIMIT 1`,
        key.userId, userSellerCountries,
      )
      if (missstand[0]) {
        console.log(`[Crawler] MISSSTAND Country-Mismatch: ${missstand[0].part_no}/${missstand[0].color_id}/${missstand[0].new_or_used}`)
        return {
          type: 'stock',  // forced -- nur Stock hat den Country-Mismatch
          partId: missstand[0].part_id,
          partNo: missstand[0].part_no,
          colorId: missstand[0].color_id,
          itemType: missstand[0].item_type,
          newOrUsed: missstand[0].new_or_used as 'N' | 'U',
          userId: key.userId,
          apiKeyId: key.id,
          consumerKey: key.consumerKey,
          consumerSecretEnc: Buffer.from(key.consumerSecretEnc),
          tokenValue: key.tokenValue,
          tokenSecretEnc: Buffer.from(key.tokenSecretEnc),
        }
      }
    }

    // Per-user freshDays
    const user = await prisma.user.findUnique({ where: { id: key.userId }, select: { freshDays: true } })
    const freshMs = (user?.freshDays ?? 14) * 24 * 60 * 60 * 1000
    const freshThreshold = new Date(Date.now() - freshMs)

    // Count stale items per type using condition-specific timestamps
    const [soldCountResult, stockCountResult] = await Promise.all([
      prisma.$queryRawUnsafe<[{ count: number }]>(
        `SELECT COUNT(*)::int as count FROM user_watchlists w
         JOIN parts p ON p.id = w.part_id
         WHERE w.user_id = $1 AND (
           (w.new_or_used = 'N' AND (p.last_sold_crawl_n IS NULL OR p.last_sold_crawl_n < $2))
           OR (w.new_or_used = 'U' AND (p.last_sold_crawl_u IS NULL OR p.last_sold_crawl_u < $2))
         )`, key.userId, freshThreshold),
      prisma.$queryRawUnsafe<[{ count: number }]>(
        `SELECT COUNT(*)::int as count FROM user_watchlists w
         JOIN parts p ON p.id = w.part_id
         WHERE w.user_id = $1 AND (
           (w.new_or_used = 'N' AND (p.last_stock_crawl_n IS NULL OR p.last_stock_crawl_n < $2))
           OR (w.new_or_used = 'U' AND (p.last_stock_crawl_u IS NULL OR p.last_stock_crawl_u < $2))
         )`, key.userId, freshThreshold),
    ])
    const soldCount = soldCountResult[0].count
    const stockCount = stockCountResult[0].count

    // Decide type: alternate, but if one side is all fresh → only do the other
    const lastType = await redis.get('crawler:lastType')
    let type: JobType
    if (soldCount === 0 && stockCount === 0) {
      // Maintenance mode: nothing stale, but pick the oldest anyway to spread evenly
      type = lastType === 'sold' ? 'stock' : 'sold'
    } else if (soldCount === 0) type = 'stock'
    else if (stockCount === 0) type = 'sold'
    else {
      type = lastType === 'sold' ? 'stock' : 'sold'
    }

    // Find oldest part for chosen type using condition-specific timestamps
    // In maintenance mode (nothing stale): pick oldest regardless of threshold
    const tsCol = type === 'stock'
      ? "CASE WHEN w.new_or_used = 'N' THEN p.last_stock_crawl_n ELSE p.last_stock_crawl_u END"
      : "CASE WHEN w.new_or_used = 'N' THEN p.last_sold_crawl_n ELSE p.last_sold_crawl_u END"

    const isMaintenanceMode = soldCount === 0 && stockCount === 0
    const chosenResult = await prisma.$queryRawUnsafe<Array<{
      wl_id: number; part_id: number; part_no: string; color_id: number;
      item_type: string; new_or_used: string;
    }>>(
      isMaintenanceMode
        ? `SELECT w.id as wl_id, p.id as part_id, p.part_no, p.color_id, p.item_type, w.new_or_used
           FROM user_watchlists w
           JOIN parts p ON p.id = w.part_id
           WHERE w.user_id = $1
           ORDER BY ${tsCol} ASC NULLS FIRST
           LIMIT 1`
        : `SELECT w.id as wl_id, p.id as part_id, p.part_no, p.color_id, p.item_type, w.new_or_used
           FROM user_watchlists w
           JOIN parts p ON p.id = w.part_id
           WHERE w.user_id = $1 AND (${tsCol} IS NULL OR ${tsCol} < $2)
           ORDER BY ${tsCol} ASC NULLS FIRST
           LIMIT 1`,
      key.userId, ...(isMaintenanceMode ? [] : [freshThreshold])
    )
    const chosen = chosenResult[0]

    if (chosen) {
      return {
        type,
        partId: chosen.part_id,
        partNo: chosen.part_no,
        colorId: chosen.color_id,
        itemType: chosen.item_type,
        newOrUsed: chosen.new_or_used as 'N' | 'U',
        userId: key.userId,
        apiKeyId: key.id,
        consumerKey: key.consumerKey,
        consumerSecretEnc: Buffer.from(key.consumerSecretEnc),
        tokenValue: key.tokenValue,
        tokenSecretEnc: Buffer.from(key.tokenSecretEnc),
      }
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Process: sold
// ---------------------------------------------------------------------------

async function processSold(job: NextJob, client: BrickLinkClient): Promise<void> {
  // Bei SETs müssen Preise pro Completeness getrennt gecrawlt werden — sonst
  // vermischen sich sealed und used-complete zu unbrauchbaren Medians.
  const completenessList: Array<'C' | 'I' | 'S' | undefined> =
    job.itemType === 'SET' ? ['C', 'I', 'S'] : [undefined]

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const CHUNK = 50
  let totalDetails = 0
  let totalDayEntries = 0

  for (const completeness of completenessList) {
    const response = await client.getPriceGuide(
      job.partNo, job.itemType, job.colorId, job.newOrUsed, 'sold', undefined, completeness
    )
    const data = response.data
    if (!data.price_detail || data.price_detail.length === 0) continue

    // Sales einfügen (mit completeness-Marker)
    for (let i = 0; i < data.price_detail.length; i += CHUNK) {
      await Promise.all(data.price_detail.slice(i, i + CHUNK).map(sale =>
        prisma.$executeRaw`
          INSERT INTO price_sales (part_id, date_ordered, unit_price, quantity, seller_country, buyer_country, new_or_used, completeness, fetched_at, created_at)
          VALUES (${job.partId}, ${new Date(sale.date_ordered)}, ${parseFloat(sale.unit_price)}::decimal(10,4),
            ${sale.quantity}, ${sale.seller_country_code || 'XX'}, ${sale.buyer_country_code || null}, ${job.newOrUsed},
            ${completeness ?? null}, ${today}, NOW())
          ON CONFLICT DO NOTHING
        `
      ))
    }
    totalDetails += data.price_detail.length

    // Daily-Rollup NUR für Non-SETs (bei SETs würde der completeness-Mix
    // die Aggregat-Werte in price_daily verfälschen — SET-Callers nutzen
    // eh price_sales mit completeness-Filter direkt).
    if (job.itemType !== 'SET') {
      const dailyMap = new Map<string, { prices: number[]; quantities: number[] }>()
      for (const sale of data.price_detail) {
        const day = sale.date_ordered.split('T')[0]
        const entry = dailyMap.get(day) || { prices: [], quantities: [] }
        entry.prices.push(parseFloat(sale.unit_price))
        entry.quantities.push(sale.quantity)
        dailyMap.set(day, entry)
      }

      const dailyEntries = Array.from(dailyMap.entries())
      for (let i = 0; i < dailyEntries.length; i += CHUNK) {
        await Promise.all(dailyEntries.slice(i, i + CHUNK).map(([dayStr, { prices, quantities }]) => {
          const fetchDate = new Date(dayStr)
          fetchDate.setHours(0, 0, 0, 0)
          const totalQty = quantities.reduce((a, b) => a + b, 0)

          return prisma.priceDaily.upsert({
            where: { partId_fetchDate_newOrUsed_sellerCountry: { partId: job.partId, fetchDate, newOrUsed: job.newOrUsed, sellerCountry: 'XX' } },
            update: {
              minPrice: Math.min(...prices), maxPrice: Math.max(...prices),
              avgPrice: prices.reduce((a, b) => a + b, 0) / prices.length,
              qtyAvgPrice: prices.reduce((s, p, i) => s + p * quantities[i], 0) / totalQty,
              unitQuantity: prices.length, totalQuantity: totalQty,
            },
            create: {
              partId: job.partId, fetchDate, newOrUsed: job.newOrUsed, sellerCountry: 'XX', currencyCode: 'EUR',
              minPrice: Math.min(...prices), maxPrice: Math.max(...prices),
              avgPrice: prices.reduce((a, b) => a + b, 0) / prices.length,
              qtyAvgPrice: prices.reduce((s, p, i) => s + p * quantities[i], 0) / totalQty,
              unitQuantity: prices.length, totalQuantity: totalQty,
            },
          })
        }))
      }
      totalDayEntries += dailyMap.size
    }
  }  // completeness-Loop

  const completenessLabel = job.itemType === 'SET' ? ' [C+I+S]' : ''
  if (totalDetails > 0) {
    console.log(`[Crawler] SOLD${completenessLabel} ${job.partNo}/${job.colorId}/${job.newOrUsed}: ${totalDetails} Sales, ${totalDayEntries} Tage`)
  } else {
    console.log(`[Crawler] SOLD${completenessLabel} ${job.partNo}/${job.colorId}/${job.newOrUsed}: keine Sales`)
  }

  const now = new Date()
  await prisma.part.update({
    where: { id: job.partId },
    data: {
      lastPriceUpdate: now,
      ...(job.newOrUsed === 'N' ? { lastSoldCrawlN: now } : { lastSoldCrawlU: now }),
    },
  })
}

// ---------------------------------------------------------------------------
// Process: stock
// ---------------------------------------------------------------------------

async function processStock(job: NextJob, client: BrickLinkClient): Promise<number> {
  // Bei SETs pro Completeness getrennt (siehe processSold-Kommentar)
  const completenessList: Array<'C' | 'I' | 'S' | undefined> =
    job.itemType === 'SET' ? ['C', 'I', 'S'] : [undefined]

  // User-Setting: sellerCountries -> pro Country separater BL-Call mit
  // country_code. BL filtert Server-seitig auf Stores in dem Land.
  // Ohne User-Setting: weltweit wie bisher (seller_country='XX').
  const { sellerCountries } = await getCountryFilters(job.userId)
  const stockCountries: Array<string | null> =
    (sellerCountries && sellerCountries.length > 0) ? sellerCountries : [null]

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const CHUNK = 50
  let totalOffers = 0

  for (const completeness of completenessList) {
    // Alten Snapshot dieses Tages einmal wegwerfen (unabhaengig vom Country)
    await prisma.$executeRaw`
      DELETE FROM price_stock
      WHERE part_id = ${job.partId}
        AND new_or_used = ${job.newOrUsed}
        AND fetched_at = ${today}
        AND completeness IS NOT DISTINCT FROM ${completeness ?? null}
    `

    for (const country of stockCountries) {
      const response = await client.getPriceGuide(
        job.partNo, job.itemType, job.colorId, job.newOrUsed, 'stock',
        country ?? undefined, completeness
      )
      const data = response.data
      if (!data.price_detail || data.price_detail.length === 0) continue

      const storeCountry = country ?? 'XX'
      for (let i = 0; i < data.price_detail.length; i += CHUNK) {
        await Promise.all(data.price_detail.slice(i, i + CHUNK).map(offer =>
          prisma.$executeRaw`
            INSERT INTO price_stock (part_id, unit_price, quantity, seller_country, new_or_used, completeness, fetched_at, created_at)
            VALUES (${job.partId}, ${parseFloat(offer.unit_price)}::decimal(10,4), ${offer.quantity},
              ${storeCountry}, ${job.newOrUsed}, ${completeness ?? null}, ${today}, NOW())
            ON CONFLICT DO NOTHING
          `
        ))
      }
      totalOffers += data.price_detail.length
    }
  }

  const completenessLabel = job.itemType === 'SET' ? ' [C+I+S]' : ''
  const countryLabel = stockCountries.length > 1 || stockCountries[0] !== null
    ? ` [${stockCountries.map(c => c ?? 'WW').join('+')}]` : ''
  console.log(`[Crawler] STOCK${completenessLabel}${countryLabel} ${job.partNo}/${job.colorId}/${job.newOrUsed}: ${totalOffers} Angebote`)

  const now = new Date()
  await prisma.part.update({
    where: { id: job.partId },
    data: {
      lastStockUpdate: now,
      ...(job.newOrUsed === 'N' ? { lastStockCrawlN: now } : { lastStockCrawlU: now }),
    },
  })

  // Return actual API calls made: completenessList * stockCountries
  return completenessList.length * stockCountries.length
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

async function crawlerLoop(): Promise<void> {
  console.log('[Crawler] Gestartet')

  while (true) {
    try {
      const loopStart = Date.now()
      const delayMs = await calculateDelay()
      if (delayMs <= 0) {
        // Kein Budget oder keine aktiven User
        await new Promise((resolve) => setTimeout(resolve, 60000))
        continue
      }

      const job = await findNextJob()
      if (!job) {
        console.log('[Crawler] Alles aktuell — warte 5 Min')
        await new Promise((resolve) => setTimeout(resolve, 300000))
        continue
      }

      const consumerSecret = decrypt(job.consumerSecretEnc)
      const tokenSecret = decrypt(job.tokenSecretEnc)
      const client = new BrickLinkClient(job.consumerKey, consumerSecret, job.tokenValue, tokenSecret, 0)

      let actualCalls: number
      if (job.type === 'sold') {
        await processSold(job, client)
        // Sold: 1 Call (bzw. 3 bei SETs -- pro Completeness), weltweit
        actualCalls = job.itemType === 'SET' ? 3 : 1
      } else {
        actualCalls = await processStock(job, client)
      }

      // Remember last type for alternation
      await redis.set('crawler:lastType', job.type)

      // Log API call(s) (rolling 24h window). processStock returned die
      // echte Call-Zahl weil bei Multi-Country-User pro Country ein Call
      // gemacht wird.
      await logApiCall(job.apiKeyId, actualCalls)

      // Clear priority flag after crawl
      await prisma.userWatchlist.updateMany({
        where: { userId: job.userId, partId: job.partId, newOrUsed: job.newOrUsed, changedAt: { not: null } },
        data: { changedAt: null },
      })

      // Recompute pricing cache for all watchlist-lots that reference this part+condition
      try {
        await recomputeAllLotsForPart(job.partId, job.newOrUsed)
      } catch (err) {
        console.error('[Crawler] Recompute-Fehler:', err instanceof Error ? err.message : err)
      }

      // Sleep remaining time (subtract processing time from target delay)
      const elapsed = Date.now() - loopStart
      const remaining = delayMs - elapsed
      if (remaining > 0) {
        console.log(`[Crawler] Pacing: ${(delayMs / 1000).toFixed(0)}s (warte ${(remaining / 1000).toFixed(0)}s)`)
        await new Promise((resolve) => setTimeout(resolve, remaining))
      } else {
        console.log(`[Crawler] Pacing: ${(delayMs / 1000).toFixed(0)}s (Verarbeitung dauerte ${(elapsed / 1000).toFixed(0)}s, kein Warten)`)
      }

    } catch (error) {
      if (error instanceof BrickLinkApiError) {
        console.error(`[Crawler] BL API: ${error.message}`)
      } else {
        console.error('[Crawler] Fehler:', error instanceof Error ? error.message : error)
      }
      await new Promise((resolve) => setTimeout(resolve, 10000))
    }
  }
}

crawlerLoop().catch((err) => { console.error('[Crawler] Fatal:', err); process.exit(1) })
process.on('SIGTERM', async () => { console.log('[Crawler] Beendet'); await prisma.$disconnect(); process.exit(0) })
process.on('SIGINT', async () => { console.log('[Crawler] Beendet'); await prisma.$disconnect(); process.exit(0) })
