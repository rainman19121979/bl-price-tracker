import { prisma } from './db'
import { decrypt } from './encryption'
import { BrickLinkClient } from './bricklink-api'
import { logApiCall } from './api-usage'

/**
 * Fetch sold + stock price data from BrickLink for a specific part/condition.
 * Saves to price_sales / price_stock and updates per-condition timestamps on parts.
 * Uses 2 API calls (sold + stock).
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

  // 1) Sold
  const soldResp = await client.getPriceGuide(part.partNo, part.itemType, part.colorId, newOrUsed)
  const soldData = soldResp.data
  let salesCount = 0
  if (soldData.price_detail?.length > 0) {
    for (const sale of soldData.price_detail) {
      await prisma.$executeRaw`
        INSERT INTO price_sales (part_id, date_ordered, unit_price, quantity,
          seller_country, buyer_country, new_or_used, fetched_at, created_at)
        VALUES (${part.id}, ${new Date(sale.date_ordered)}, ${parseFloat(sale.unit_price)}::decimal(10,4),
          ${sale.quantity}, ${sale.seller_country_code || 'DE'},
          ${sale.buyer_country_code || null}, ${newOrUsed}, ${today}, NOW())
        ON CONFLICT DO NOTHING
      `
    }
    salesCount = soldData.price_detail.length
  }
  await prisma.part.update({
    where: { id: part.id },
    data: {
      lastPriceUpdate: now,
      ...(newOrUsed === 'N' ? { lastSoldCrawlN: now } : { lastSoldCrawlU: now }),
    },
  })

  // 2) Stock
  let stockCount = 0
  try {
    const stockResp = await client.getPriceGuide(part.partNo, part.itemType, part.colorId, newOrUsed, 'DE', 'stock')
    const stockData = stockResp.data
    await prisma.$executeRaw`
      DELETE FROM price_stock WHERE part_id = ${part.id} AND new_or_used = ${newOrUsed} AND fetched_at = ${today}
    `
    if (stockData.price_detail?.length > 0) {
      for (const offer of stockData.price_detail) {
        await prisma.$executeRaw`
          INSERT INTO price_stock (part_id, unit_price, quantity, seller_country, new_or_used, fetched_at, created_at)
          VALUES (${part.id}, ${parseFloat(offer.unit_price)}::decimal(10,4), ${offer.quantity}, 'DE', ${newOrUsed}, ${today}, NOW())
          ON CONFLICT DO NOTHING
        `
      }
      stockCount = stockData.price_detail.length
    }
    await prisma.part.update({
      where: { id: part.id },
      data: {
        lastStockUpdate: new Date(),
        ...(newOrUsed === 'N' ? { lastStockCrawlN: new Date() } : { lastStockCrawlU: new Date() }),
      },
    })
  } catch {
    // Stock error not fatal
  }

  await logApiCall(apiKey.id, 2)
  return { salesCount, stockCount }
}
