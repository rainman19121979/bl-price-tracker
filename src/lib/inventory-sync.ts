import { prisma } from './db'
import { decrypt } from './encryption'
import { BrickLinkClient } from './bricklink-api'
import { logApiCall } from './api-usage'
import { decodeHtmlEntities } from './html-entities'
import { recomputeAllLotsForUser } from './lot-pricing'

export interface SyncResult {
  totalLots: number
  added: number
  updated: number
  removed: number
  errors: number
  newPartIds: Array<{ partId: number; newOrUsed: 'N' | 'U'; partNo: string; colorId: number; itemType: string }>
}

/**
 * Syncs BrickLink inventory for a user.
 * Returns counts + list of newly added part IDs (for follow-up price fetch).
 * Uses 1 API call (getInventory).
 */
export async function syncBricklinkInventory(userId: number): Promise<SyncResult> {
  const apiKey = await prisma.userApiKey.findFirst({
    where: { userId, isValid: true },
    orderBy: { createdAt: 'desc' },
  })
  if (!apiKey) throw new Error('Kein gueltiger API-Key hinterlegt.')

  const consumerSecret = decrypt(apiKey.consumerSecretEnc)
  const tokenSecret = decrypt(apiKey.tokenSecretEnc)
  const client = new BrickLinkClient(
    apiKey.consumerKey, consumerSecret, apiKey.tokenValue, tokenSecret, 500
  )

  const inventory = await client.getInventory()
  if (!inventory.data || inventory.data.length === 0) {
    throw new Error('BrickLink-Inventar ist leer.')
  }

  const blLotIds = new Set<number>()
  let addedCount = 0
  let updatedCount = 0
  let errorCount = 0
  const newPartIds: SyncResult['newPartIds'] = []

  const partNos = Array.from(new Set(inventory.data.map((i: { item: { no: string } }) => i.item.no)))
  const existingParts = await prisma.part.findMany({ where: { partNo: { in: partNos } } })
  const partLookup = new Map(existingParts.map(p => [`${p.partNo}:${p.colorId}:${p.itemType}`, p]))

  const blInventoryIds = inventory.data.map((i: { inventory_id: number }) => i.inventory_id)
  const existingWatchlist = await prisma.userWatchlist.findMany({
    where: { userId, blInventoryId: { in: blInventoryIds } },
  })
  const wlLookup = new Map(existingWatchlist.map(w => [w.blInventoryId!, w]))

  for (const item of inventory.data) {
    const blInventoryId = item.inventory_id
    blLotIds.add(blInventoryId)

    const partNo = item.item.no
    const colorId = item.color_id
    const itemType = item.item.type || 'PART'
    const newOrUsed = (item.new_or_used === 'N' ? 'N' : 'U') as 'N' | 'U'
    const price = parseFloat(item.unit_price) || null
    const qty = item.quantity || 0
    const desc = item.description || null
    const saleRate = item.sale_rate || 0
    const myCost = parseFloat(item.my_cost) || null
    const rmks = item.remarks || null

    try {
      const partKey = `${partNo}:${colorId}:${itemType}`
      let part = partLookup.get(partKey) ?? null

      if (!part) {
        part = await prisma.part.create({
          data: {
            partNo, colorId, itemType,
            partName: decodeHtmlEntities(item.item.name || ''),
            colorName: decodeHtmlEntities(item.color_name || ''),
            categoryId: item.item.category_id || null,
          },
        })
        partLookup.set(partKey, part)
      } else if (!part.partName && item.item.name) {
        part = await prisma.part.update({
          where: { id: part.id },
          data: {
            partName: decodeHtmlEntities(item.item.name),
            colorName: decodeHtmlEntities(item.color_name || ''),
            categoryId: item.item.category_id || null,
          },
        })
        partLookup.set(partKey, part)
      }

      const existing = wlLookup.get(blInventoryId) ?? null

      if (existing) {
        const oldQty = existing.myQuantity ?? 0
        const oldPrice = existing.myPrice ? Number(existing.myPrice) : null
        const qtyChanged = qty !== oldQty
        const priceChanged = price !== oldPrice
        // NOTE: my_sales is now sourced exclusively from BSX order files (lib/bsx-orders.ts).
        // The legacy quantity-diff detection produced unreliable entries (without platform/order_id)
        // and would duplicate the BSX sales — removed intentionally.

        await prisma.userWatchlist.update({
          where: { id: existing.id },
          data: {
            myPrice: price, myQuantity: qty, prevQuantity: oldQty,
            changedAt: (qtyChanged || priceChanged) ? new Date() : existing.changedAt,
            description: desc, saleRate, myCost, remarks: rmks,
            partId: part.id, newOrUsed,
          },
        })
        updatedCount++
      } else {
        await prisma.userWatchlist.create({
          data: {
            userId, partId: part.id, newOrUsed, blInventoryId,
            myPrice: price, myQuantity: qty, description: desc,
            saleRate, myCost, remarks: rmks,
          },
        })

        // Track new part for follow-up price fetch if no data yet
        const tsField = newOrUsed === 'N' ? part.lastSoldCrawlN : part.lastSoldCrawlU
        if (!tsField) {
          newPartIds.push({ partId: part.id, newOrUsed, partNo, colorId, itemType })
        }

        addedCount++
      }
    } catch (err) {
      errorCount++
      if (errorCount <= 5) {
        console.error(`[syncInventory] Error lot ${blInventoryId}:`, err instanceof Error ? err.message : err)
      }
    }
  }

  // Track sales for lots that disappeared
  // Lots that disappeared from BL inventory are simply removed —
  // sales are tracked via BSX (lib/bsx-orders.ts), not via inventory diffs.
  const removedLots = await prisma.userWatchlist.deleteMany({
    where: { userId, blInventoryId: { not: null, notIn: Array.from(blLotIds) } },
  })

  await logApiCall(apiKey.id)

  // Recompute pricing cache for all lots of this user (myCost/myPrice/saleRate may have changed)
  try {
    await recomputeAllLotsForUser(userId)
  } catch (err) {
    console.error('[inventory-sync] Recompute-Fehler:', err instanceof Error ? err.message : err)
  }

  return {
    totalLots: inventory.data.length,
    added: addedCount,
    updated: updatedCount,
    removed: removedLots.count,
    errors: errorCount,
    newPartIds,
  }
}
