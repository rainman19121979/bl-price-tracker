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
  apiKeyId: number,
  opts?: {
    /**
     * Wenn gesetzt: Stock-Crawl wird pro Country separat gemacht mit
     * BL-Parameter country_code. Speicherung in price_stock.seller_country
     * = jeweiliger Country-Code (statt 'XX'). Ohne diesen Param laeuft der
     * Stock-Crawl weltweit ohne Filter und alle Zeilen landen als 'XX'.
     *
     * Grund: BL liefert bei Stock KEIN seller_country_code pro Entry
     * (nur bei Sold). Ohne Server-Filter wissen wir nicht wer wo sitzt.
     * Mit country_code=DE filtert BL Server-seitig auf DE-Stores.
     *
     * Sold-Crawl bleibt IMMER weltweit (der hat per-entry Country-Codes).
     */
    stockCountryCodes?: string[]
  },
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

    // 2) Stock -- pro country_code separat (BL filtert Server-seitig,
    // liefert aber KEIN seller_country_code pro Entry -- wir setzen es
    // aus dem Query-Parameter). Ohne opts.stockCountryCodes: weltweit
    // wie bisher, alles landet als 'XX'.
    const stockCountries: Array<string | null> =
      (opts?.stockCountryCodes && opts.stockCountryCodes.length > 0)
        ? opts.stockCountryCodes
        : [null]

    // Alte Snapshots dieses Tages einmal wegwerfen (unabhaengig vom Country)
    await prisma.$executeRaw`
      DELETE FROM price_stock
      WHERE part_id = ${part.id}
        AND new_or_used = ${newOrUsed}
        AND fetched_at = ${today}
        AND completeness IS NOT DISTINCT FROM ${completeness ?? null}
    `

    for (const country of stockCountries) {
      try {
        const stockResp = await client.getPriceGuide(
          part.partNo, part.itemType, part.colorId, newOrUsed, 'stock',
          country ?? undefined, completeness
        )
        apiCalls++
        const stockData = stockResp.data
        if (stockData.price_detail?.length > 0) {
          const storeCountry = country ?? 'XX'
          for (const offer of stockData.price_detail) {
            await prisma.$executeRaw`
              INSERT INTO price_stock (part_id, unit_price, quantity, seller_country,
                new_or_used, completeness, fetched_at, created_at)
              VALUES (${part.id}, ${parseFloat(offer.unit_price)}::decimal(10,4), ${offer.quantity},
                ${storeCountry}, ${newOrUsed}, ${completeness ?? null}, ${today}, NOW())
              ON CONFLICT DO NOTHING
            `
          }
          stockCount += stockData.price_detail.length
        }
      } catch {
        // dito -- fuer andere countries weiterversuchen
      }
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

  // Cache fuer alle Watchlist-Lots dieses Parts+Zustands neu berechnen.
  // Ohne das bleibt der user_watchlists.suggestedPrice-Cache stale
  // wenn fetchPriceData ausserhalb des Crawler-Workers getriggered wird
  // (external API, /inventory/sync-and-fetch, watchlist-lots-upsert).
  try {
    const { recomputeAllLotsForPart } = await import('./lot-pricing')
    await recomputeAllLotsForPart(part.id, newOrUsed)
  } catch (err) {
    // Cache-Update ist nur Perf-Opt, Fetch selbst war erfolgreich
    console.error('[fetchPriceData] Recompute-Fehler:', err instanceof Error ? err.message : err)
  }

  return { salesCount, stockCount }
}
