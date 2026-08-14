import { prisma } from './db'
import { decrypt } from './encryption'
import { BrickLinkClient } from './bricklink-api'
import { logApiCall } from './api-usage'

/**
 * Fetch sold + stock price data from BrickLink for a specific part/condition.
 * Saves to price_sales / price_stock and updates per-condition timestamps on parts.
 *
 * Für PART / MINIFIG: 2 API-Calls (sold + stock).
 * Für SET: 6 API-Calls — je 2× für C (complete), I (incomplete), S (sealed).
 * Grund: BL liefert bei SETs ohne completeness-Parameter einen Mix, der die
 * Preise verwässert (sealed 3-5× teurer als used-complete). Wir crawlen
 * deshalb separat.
 */
export async function fetchPriceData(
  part: { id: number; partNo: string; colorId: number; itemType: string },
  newOrUsed: 'N' | 'U',
  apiKeyId: number
): Promise<{ salesCount: number; stockCount: number }> {
  const apiKey = await prisma.userApiKey.findUnique({ where: { id: apiKeyId } })
  if (!apiKey) throw new Error('API-Key nicht gefunden')

  const consumerSecret = decrypt(apiKey.consumerSecretEnc)
  const tokenSecret = decrypt(apiKey.tokenSecretEnc)
  const client = new BrickLinkClient(
    apiKey.consumerKey, consumerSecret, apiKey.tokenValue, tokenSecret, 0
  )

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const now = new Date()

  // Für SETs pro Completeness-Wert einzeln, für PART/MINIFIG einmal ohne
  const completenessList: Array<'C' | 'I' | 'S' | undefined> =
    part.itemType === 'SET' ? ['C', 'I', 'S'] : [undefined]

  let salesCount = 0
  let stockCount = 0
  let apiCalls = 0

  for (const completeness of completenessList) {
    // 1) Sold
    try {
      const soldResp = await client.getPriceGuide(
        part.partNo, part.itemType, part.colorId, newOrUsed, 'sold', undefined, completeness
      )
      apiCalls++
      const soldData = soldResp.data
      if (soldData.price_detail?.length > 0) {
        for (const sale of soldData.price_detail) {
          await prisma.$executeRaw`
            INSERT INTO price_sales (part_id, date_ordered, unit_price, quantity,
              seller_country, buyer_country, new_or_used, completeness, fetched_at, created_at)
            VALUES (${part.id}, ${new Date(sale.date_ordered)}, ${parseFloat(sale.unit_price)}::decimal(10,4),
              ${sale.quantity}, ${sale.seller_country_code || 'XX'},
              ${sale.buyer_country_code || null}, ${newOrUsed}, ${completeness ?? null}, ${today}, NOW())
            ON CONFLICT DO NOTHING
          `
        }
        salesCount += soldData.price_detail.length
      }
    } catch {
      // Wenn BL für diese Completeness keine Daten hat oder Fehler wirft,
      // die anderen Werte trotzdem versuchen.
    }

    // 2) Stock
    try {
      const stockResp = await client.getPriceGuide(
        part.partNo, part.itemType, part.colorId, newOrUsed, 'stock', undefined, completeness
      )
      apiCalls++
      const stockData = stockResp.data
      // Alte Snapshots dieses Tages für gleiche (part, condition, completeness) wegwerfen
      await prisma.$executeRaw`
        DELETE FROM price_stock
        WHERE part_id = ${part.id}
          AND new_or_used = ${newOrUsed}
          AND fetched_at = ${today}
          AND completeness IS NOT DISTINCT FROM ${completeness ?? null}
      `
      if (stockData.price_detail?.length > 0) {
        for (const offer of stockData.price_detail) {
          await prisma.$executeRaw`
            INSERT INTO price_stock (part_id, unit_price, quantity, seller_country,
              new_or_used, completeness, fetched_at, created_at)
            VALUES (${part.id}, ${parseFloat(offer.unit_price)}::decimal(10,4), ${offer.quantity},
              ${offer.seller_country_code || 'XX'}, ${newOrUsed}, ${completeness ?? null}, ${today}, NOW())
            ON CONFLICT DO NOTHING
          `
        }
        stockCount += stockData.price_detail.length
      }
    } catch {
      // dito
    }
  }

  // Timestamps auf part einmalig pro Aufruf setzen (nicht per completeness)
  await prisma.part.update({
    where: { id: part.id },
    data: {
      lastPriceUpdate: now,
      lastStockUpdate: now,
      ...(newOrUsed === 'N'
        ? { lastSoldCrawlN: now, lastStockCrawlN: now }
        : { lastSoldCrawlU: now, lastStockCrawlU: now }),
    },
  })

  await logApiCall(apiKey.id, apiCalls)
  return { salesCount, stockCount }
}
