import { prisma } from './db'

/**
 * Recompute price_daily rollups for a given set of (partId, date, condition)
 * keys — reads from the current state of price_sales and upserts the
 * aggregate row.
 *
 * Genutzt vom Preisdaten-Import (nachdem neue Sales via ON CONFLICT DO NOTHING
 * eingemergt wurden — die alten Rollups sind dann inkonsistent).
 *
 * Semantik (identisch zum Crawler in workers/crawler.ts):
 *   - Nur Non-SET-Parts. Bei SETs wird kein daily-Rollup gefuehrt weil der
 *     Aggregat-Mix ueber Completeness-Varianten wenig aussagt -- SET-Callers
 *     nutzen price_sales direkt mit completeness-Filter.
 *   - sellerCountry-Sentinel 'XX' (global across sellers), currency 'EUR'.
 *   - Aggregate: min/max/avg/qty_weighted_avg/count/sum(qty).
 *
 * Returned: Anzahl der Kombis die tatsaechlich neu berechnet wurden.
 */
export async function recomputePriceDaily(
  keys: Array<{ partId: number; date: Date; newOrUsed: 'N' | 'U' }>,
): Promise<number> {
  if (keys.length === 0) return 0

  // Dedup keys (Set-Semantik auf Basis des String-Composites)
  const uniqKeys = new Map<string, { partId: number; date: Date; newOrUsed: 'N' | 'U' }>()
  for (const k of keys) {
    const dayStart = new Date(k.date)
    dayStart.setUTCHours(0, 0, 0, 0)
    const dedupKey = `${k.partId}:${dayStart.toISOString().slice(0, 10)}:${k.newOrUsed}`
    if (!uniqKeys.has(dedupKey)) {
      uniqKeys.set(dedupKey, { partId: k.partId, date: dayStart, newOrUsed: k.newOrUsed })
    }
  }

  // Non-SET-Filter: nur Parts mit itemType != 'SET' rollupen
  const partIds = Array.from(new Set(Array.from(uniqKeys.values()).map(k => k.partId)))
  const parts = await prisma.part.findMany({
    where: { id: { in: partIds } },
    select: { id: true, itemType: true },
  })
  const nonSetPartIds = new Set(parts.filter(p => p.itemType !== 'SET').map(p => p.id))

  const targets = Array.from(uniqKeys.values()).filter(k => nonSetPartIds.has(k.partId))
  if (targets.length === 0) return 0

  let recomputed = 0
  // Chunked, damit wir bei grossen Imports die DB nicht mit ~10k parallelen
  // Queries fluten. 20 gleichzeitig ist ein bewaehrter Kompromiss.
  const CHUNK = 20
  for (let i = 0; i < targets.length; i += CHUNK) {
    const batch = targets.slice(i, i + CHUNK)
    const results = await Promise.all(batch.map(async ({ partId, date, newOrUsed }) => {
      // Ein SQL-Statement: aggregate aus price_sales, dann upsert in price_daily.
      // Bei 0 Sales fuer die Kombi macht das RETURNING nichts zurueck (kein
      // Upsert), das ist ok -- eine "leere" daily-Zeile brauchen wir nicht.
      const rows = await prisma.$queryRaw<Array<{
        min_price: string | null; max_price: string | null;
        avg_price: string | null; qty_avg_price: string | null;
        unit_quantity: number; total_quantity: number | null;
      }>>`
        SELECT
          MIN(unit_price)::text AS min_price,
          MAX(unit_price)::text AS max_price,
          AVG(unit_price)::text AS avg_price,
          (SUM(unit_price * quantity) / NULLIF(SUM(quantity), 0))::text AS qty_avg_price,
          COUNT(*)::int AS unit_quantity,
          SUM(quantity)::int AS total_quantity
        FROM price_sales
        WHERE part_id = ${partId}
          AND date_ordered::date = ${date}::date
          AND new_or_used = ${newOrUsed}
      `
      if (!rows[0] || rows[0].unit_quantity === 0) return false

      const r = rows[0]
      await prisma.priceDaily.upsert({
        where: {
          partId_fetchDate_newOrUsed_sellerCountry: {
            partId, fetchDate: date, newOrUsed, sellerCountry: 'XX',
          },
        },
        create: {
          partId, fetchDate: date, newOrUsed, sellerCountry: 'XX', currencyCode: 'EUR',
          minPrice: r.min_price, maxPrice: r.max_price,
          avgPrice: r.avg_price, qtyAvgPrice: r.qty_avg_price,
          unitQuantity: r.unit_quantity, totalQuantity: r.total_quantity,
        },
        update: {
          minPrice: r.min_price, maxPrice: r.max_price,
          avgPrice: r.avg_price, qtyAvgPrice: r.qty_avg_price,
          unitQuantity: r.unit_quantity, totalQuantity: r.total_quantity,
        },
      })
      return true
    }))
    recomputed += results.filter(Boolean).length
  }

  return recomputed
}
