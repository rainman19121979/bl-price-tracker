import { prisma } from './db'
import { fetchPriceData } from './fetch-prices'
import { getCountryFilters } from './user-settings'
import { logApiCall, getUsage, getExternalCallCount } from './api-usage'
import { recomputeLotPricing } from './lot-pricing'

export interface LotUpsertInput {
  blInventoryId: number
  partNo: string
  colorId: number
  itemType: 'PART' | 'MINIFIG' | 'SET'
  condition: 'N' | 'U'
  completeness?: 'C' | 'I' | 'S'  // nur bei SET
  myPrice?: number
  myQuantity?: number
  myCost?: number
  description?: string
  remarks?: string
  saleRate?: number
  priceLocked?: boolean
}

export interface LotUpsertResult {
  blInventoryId: number
  partNo: string
  colorId: number
  itemType: string
  condition: 'N' | 'U'
  wasCreated: boolean
  partWasCreated: boolean
  freshlyCrawled: boolean
  suggestedPrice: number | null
  suggestedRuleName: string | null
  marketStockMedian: number | null
  marketSoldMedian: number | null
  trend: string | null
}

export interface LotUpsertError {
  blInventoryId: number
  partNo: string
  error: string
}

export function isLotError(r: LotUpsertResult | LotUpsertError): r is LotUpsertError {
  return 'error' in r
}

export function validateLot(raw: Record<string, unknown>): { ok: true; lot: LotUpsertInput } | { ok: false; error: string } {
  const blInventoryId = typeof raw.blInventoryId === 'number' ? raw.blInventoryId : parseInt(String(raw.blInventoryId))
  const partNo = typeof raw.partNo === 'string' ? raw.partNo.trim() : ''
  const colorId = typeof raw.colorId === 'number' ? raw.colorId : parseInt(String(raw.colorId))
  const itemType = typeof raw.itemType === 'string' ? raw.itemType.toUpperCase() : ''
  const condition = typeof raw.condition === 'string' ? raw.condition.toUpperCase() : ''

  if (!Number.isFinite(blInventoryId) || blInventoryId <= 0) return { ok: false, error: 'blInventoryId must be positive number' }
  if (!partNo) return { ok: false, error: 'partNo required' }
  if (!Number.isFinite(colorId)) return { ok: false, error: 'colorId must be number' }
  if (!['PART', 'MINIFIG', 'SET'].includes(itemType)) return { ok: false, error: 'itemType must be PART|MINIFIG|SET' }
  if (!['N', 'U'].includes(condition)) return { ok: false, error: 'condition must be N|U' }

  const completenessRaw = typeof raw.completeness === 'string' ? raw.completeness.toUpperCase() : ''
  if (completenessRaw && !['C', 'I', 'S'].includes(completenessRaw)) {
    return { ok: false, error: 'completeness must be C|I|S if provided' }
  }
  const completeness = itemType === 'SET' && completenessRaw ? (completenessRaw as 'C' | 'I' | 'S') : undefined

  const optional = <T,>(v: unknown, coerce: (x: unknown) => T | null): T | undefined => {
    if (v === undefined || v === null) return undefined
    const c = coerce(v)
    return c === null ? undefined : c
  }
  const num = (v: unknown) => {
    if (typeof v === 'number') return v
    const p = parseFloat(String(v))
    return Number.isFinite(p) ? p : null
  }
  const int = (v: unknown) => {
    if (typeof v === 'number') return Math.floor(v)
    const p = parseInt(String(v))
    return Number.isFinite(p) ? p : null
  }
  const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 500) : null)

  return {
    ok: true,
    lot: {
      blInventoryId, partNo,
      colorId, itemType: itemType as 'PART' | 'MINIFIG' | 'SET',
      condition: condition as 'N' | 'U',
      completeness,
      myPrice: optional(raw.myPrice, num),
      myQuantity: optional(raw.myQuantity, int),
      myCost: optional(raw.myCost, num),
      description: optional(raw.description, str),
      remarks: optional(raw.remarks, str),
      saleRate: optional(raw.saleRate, int),
      priceLocked: typeof raw.priceLocked === 'boolean' ? raw.priceLocked : undefined,
    },
  }
}

/**
 * Upsert a single lot into user_watchlists.
 * - Creates Part on-demand if unknown (findPart-style lookup by exact partNo+colorId+itemType)
 * - Fetches BL price data ONLY if missing or stale (2 BL calls)
 * - Recomputes pricing cache for this lot
 * - Never fetches BL inventory itself (that's what makes it useful when hb-tool pushes)
 */
export async function upsertLot(
  userId: number,
  lot: LotUpsertInput,
  opts: { skipPriceFetch?: boolean; freshDays: number },
): Promise<LotUpsertResult | LotUpsertError> {
  let part = await prisma.part.findUnique({
    where: { partNo_colorId_itemType: { partNo: lot.partNo, colorId: lot.colorId, itemType: lot.itemType } },
  })
  const partWasCreated = !part
  if (!part) {
    part = await prisma.part.create({
      data: { partNo: lot.partNo, colorId: lot.colorId, itemType: lot.itemType },
    })
  }

  let freshlyCrawled = false
  const soldTs = lot.condition === 'N' ? part.lastSoldCrawlN : part.lastSoldCrawlU
  const stockTs = lot.condition === 'N' ? part.lastStockCrawlN : part.lastStockCrawlU
  const freshThreshold = new Date(Date.now() - opts.freshDays * 86400000)
  const isStale = !soldTs || !stockTs || soldTs < freshThreshold || stockTs < freshThreshold

  if (isStale && !opts.skipPriceFetch) {
    const apiKey = await prisma.userApiKey.findFirst({
      where: { userId, isValid: true },
      orderBy: { createdAt: 'desc' },
    })
    if (apiKey) {
      const used = await getUsage(apiKey.id)
      const ext = await getExternalCallCount(userId)
      if (apiKey.dailyLimit - used - ext >= 2) {
        try {
          const { sellerCountries: scForFetch } = await getCountryFilters(userId)
          await fetchPriceData(part, lot.condition, apiKey.id, {
            stockCountryCodes: scForFetch ?? undefined,
          })
          await logApiCall(apiKey.id)
          freshlyCrawled = true
        } catch (err) {
          // On BL 404 for a fresh part, delete it and error out
          if (partWasCreated) {
            await prisma.part.delete({ where: { id: part.id } }).catch(() => {})
          }
          return {
            blInventoryId: lot.blInventoryId,
            partNo: lot.partNo,
            error: err instanceof Error ? err.message : 'BL fetch failed',
          }
        }
      }
    }
  }

  // Upsert watchlist entry
  const existing = await prisma.userWatchlist.findUnique({
    where: { userId_blInventoryId: { userId, blInventoryId: lot.blInventoryId } },
  })
  const wasCreated = !existing

  const oldQty = existing?.myQuantity ?? 0
  const oldPrice = existing?.myPrice ? Number(existing.myPrice) : null
  const priceNum = lot.myPrice ?? null
  const qtyNum = lot.myQuantity ?? 0
  const changed = wasCreated || qtyNum !== oldQty || priceNum !== oldPrice

  const saved = await prisma.userWatchlist.upsert({
    where: { userId_blInventoryId: { userId, blInventoryId: lot.blInventoryId } },
    create: {
      userId, partId: part.id, newOrUsed: lot.condition, completeness: lot.completeness ?? null, blInventoryId: lot.blInventoryId,
      myPrice: priceNum, myQuantity: qtyNum,
      myCost: lot.myCost ?? null,
      description: lot.description ?? null,
      remarks: lot.remarks ?? null,
      saleRate: lot.saleRate ?? 0,
      priceLocked: lot.priceLocked ?? false,
      changedAt: changed ? new Date() : null,
    },
    update: {
      partId: part.id, newOrUsed: lot.condition, completeness: lot.completeness ?? null,
      myPrice: priceNum, myQuantity: qtyNum, prevQuantity: oldQty,
      myCost: lot.myCost ?? existing?.myCost ?? null,
      description: lot.description ?? existing?.description ?? null,
      remarks: lot.remarks ?? existing?.remarks ?? null,
      saleRate: lot.saleRate ?? existing?.saleRate ?? 0,
      priceLocked: lot.priceLocked ?? existing?.priceLocked ?? false,
      changedAt: changed ? new Date() : existing?.changedAt,
    },
  })

  try {
    await recomputeLotPricing(saved.id)
  } catch {
    // ignore — cache stays stale but lot is saved
  }

  const refreshed = await prisma.userWatchlist.findUnique({
    where: { id: saved.id },
    select: {
      suggestedPrice: true, suggestedRuleName: true,
      marketStockMedian: true, marketSoldMedian: true, trend: true,
    },
  })

  return {
    blInventoryId: lot.blInventoryId,
    partNo: lot.partNo,
    colorId: lot.colorId,
    itemType: lot.itemType,
    condition: lot.condition,
    wasCreated,
    partWasCreated,
    freshlyCrawled,
    suggestedPrice: refreshed?.suggestedPrice ? Number(refreshed.suggestedPrice) : null,
    suggestedRuleName: refreshed?.suggestedRuleName ?? null,
    marketStockMedian: refreshed?.marketStockMedian ? Number(refreshed.marketStockMedian) : null,
    marketSoldMedian: refreshed?.marketSoldMedian ? Number(refreshed.marketSoldMedian) : null,
    trend: refreshed?.trend ?? null,
  }
}

export async function deleteLots(userId: number, blInventoryIds: number[]): Promise<number> {
  if (blInventoryIds.length === 0) return 0
  const result = await prisma.userWatchlist.deleteMany({
    where: { userId, blInventoryId: { in: blInventoryIds } },
  })
  return result.count
}
