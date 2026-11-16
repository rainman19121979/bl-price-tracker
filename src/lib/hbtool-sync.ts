import { prisma } from './db'
import { decodeHtmlEntities } from './html-entities'
import { findOrCreatePart } from './bsx-orders'
import { findPart } from './find-part'
import { recomputeAllLotsForUser, recomputeLotPricing } from './lot-pricing'
import { hbtoolGet, HbtoolError, loadUserHbtoolSource, type HbtoolSource } from './hbtool-source'
import { fetchHbtoolBudget, type HbtoolBudget } from './hbtool-budget'

// ---------------------------------------------------------------------------
// Inventar + Bestellungen aus hb-tool uebernehmen.
//
// Inventar: hb-tool liefert IMMER den kompletten Bestand -> wir gleichen ab
// (neu / geaendert / fehlt -> loeschen). Nur tatsaechlich geaenderte Lots
// werden geschrieben und neu bepreist. ETag/304 spart den Abgleich ganz.
// Bremse: schrumpft der Bestand um mehr als 20 %, wird nichts geaendert.
//
// Bestellungen: Cursor `changedSince` (inklusive, Ueberschneidung gewollt).
// Pro Bestellung werden alle my_sales-Zeilen ersetzt -> idempotent, Stornos
// und Erstattungen werden nachgezogen. Alte BSX-Zeilen mit gleicher
// Bestellnummer werden dabei ersetzt.
// ---------------------------------------------------------------------------

const PRICED_TYPES = new Set(['PART', 'MINIFIG', 'SET'])
const BL_TYPES = new Set(['PART', 'MINIFIG', 'SET', 'GEAR', 'BOOK', 'CATALOG', 'INSTRUCTION', 'ORIGINAL_BOX'])
const ORDERS_START = '2000-01-01T00:00:00Z'
// hb-tool liefert die Lot-Markt-Codes (BL/BO); die Langform zur Sicherheit auch
const MARKETS: Record<string, 'BL' | 'BO'> = { bl: 'BL', bricklink: 'BL', bo: 'BO', brickowl: 'BO' }
const ORDERS_PAGE_LIMIT = 500
const ORDERS_MAX_PAGES = 100
const SHRINK_GUARD = 0.8
const SHRINK_GUARD_MIN_LOTS = 50
// Ab so vielen geaenderten Lots lohnt der Batch-Recompute ueber alle Lots
const BATCH_RECOMPUTE_THRESHOLD = 300

export const SHRINK_GUARD_PREFIX = 'Bremse:'

interface HbtoolLot {
  lotId: number
  blLotId: number
  itemType: string | null
  itemNo: string
  colorId: number
  itemName?: string | null
  colorName?: string | null
  categoryId?: number | null
  condition: string | null
  completeness: string | null
  quantity: number
  price: number | null
  cost?: number | null
  saleRate?: number
  description?: string
  remarks?: string
}

interface HbtoolOrderItem {
  blLotId: number | null
  itemType: string | null
  itemNo: string
  colorId: number
  condition: string | null
  completeness: string | null
  quantity: number
  refundedQuantity?: number
  unitPrice: number | null
}

interface HbtoolOrder {
  market: string
  orderId: string
  orderedAt: string | null
  changedAt: string | null
  status?: string
  cancelled: boolean
  test?: boolean
  currency: string | null
  items: HbtoolOrderItem[]
}

/** hb-tool fuehrt "unvollstaendig" als B (BrickLink-Inventar), der Tracker als I. */
function mapCompleteness(itemType: string, raw: string | null): string | null {
  if (itemType !== 'SET' || !raw) return null
  const c = raw.toUpperCase()
  if (c === 'B' || c === 'I') return 'I'
  if (c === 'C' || c === 'S') return c
  return null
}

function sameNum(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b
  return Math.abs(a - b) < 0.00005
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

// ---------------------------------------------------------------------------
// Inventar
// ---------------------------------------------------------------------------

export interface HbtoolInventoryResult {
  notModified: boolean
  totalLots: number
  added: number
  updated: number
  removed: number
  skipped: number
}

export async function syncInventoryFromHbtool(
  userId: number,
  source: HbtoolSource,
  opts: { force?: boolean } = {},
): Promise<HbtoolInventoryResult> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { hbtoolInventoryEtag: true } })
  const headers: Record<string, string> = {}
  if (user?.hbtoolInventoryEtag && !opts.force) headers['If-None-Match'] = user.hbtoolInventoryEtag

  const res = await hbtoolGet(source, '/api/tracker/inventory', headers)
  if (res.status === 304) {
    await prisma.user.update({ where: { id: userId }, data: { hbtoolLastInventoryAt: new Date() } })
    return { notModified: true, totalLots: 0, added: 0, updated: 0, removed: 0, skipped: 0 }
  }

  const data = await res.json() as { count?: number; lots?: HbtoolLot[] }
  if (!Array.isArray(data.lots)) throw new HbtoolError('Inventar-Antwort enthält keine Lot-Liste')
  if (typeof data.count === 'number' && data.count !== data.lots.length) {
    throw new HbtoolError(`Inventar unvollständig: count=${data.count}, geliefert ${data.lots.length}`)
  }
  const lots = data.lots

  const existing = await prisma.userWatchlist.findMany({
    where: { userId, blInventoryId: { not: null } },
    include: { part: { select: { itemType: true } } },
  })
  const wlLookup = new Map(existing.map(w => [w.blInventoryId!, w]))

  // Bremse gegen Massenloeschung (z. B. halbe Liste nach Fehler in hb-tool)
  if (!opts.force && existing.length >= SHRINK_GUARD_MIN_LOTS && lots.length < existing.length * SHRINK_GUARD) {
    throw new HbtoolError(
      `${SHRINK_GUARD_PREFIX} hb-tool liefert ${lots.length} Lots, bisher ${existing.length} ` +
      `(−${Math.round((1 - lots.length / existing.length) * 100)} %). Nichts geändert. ` +
      `Wenn das stimmt, in den Einstellungen „Trotzdem übernehmen" klicken.`,
    )
  }

  const partNos = Array.from(new Set(lots.map(l => l.itemNo).filter(Boolean)))
  const knownParts = await prisma.part.findMany({ where: { partNo: { in: partNos } } })
  const partLookup = new Map(knownParts.map(p => [`${p.partNo}:${p.colorId}:${p.itemType}`, p]))

  const seen = new Set<number>()
  const changedIds: number[] = []
  let added = 0, updated = 0, skipped = 0, errors = 0

  for (const lot of lots) {
    if (!Number.isInteger(lot.blLotId)) { skipped++; continue }
    seen.add(lot.blLotId)
    const ex = wlLookup.get(lot.blLotId) ?? null

    // Unbekannter Typ: vorhandenes Lot behalten (nicht loeschen), neues ueberspringen
    const itemType = lot.itemType && PRICED_TYPES.has(lot.itemType) ? lot.itemType : (ex && !lot.itemType ? ex.part.itemType : null)
    const newOrUsed = lot.condition === 'N' || lot.condition === 'U' ? lot.condition : null
    if (!itemType || !newOrUsed || !lot.itemNo || !Number.isInteger(lot.colorId)) { skipped++; continue }

    try {
      const partKey = `${lot.itemNo}:${lot.colorId}:${itemType}`
      let part = partLookup.get(partKey) ?? null
      const partName = lot.itemName ? decodeHtmlEntities(lot.itemName) : null
      const colorName = lot.colorName ? decodeHtmlEntities(lot.colorName) : null
      if (!part) {
        part = await prisma.part.create({
          data: {
            partNo: lot.itemNo, colorId: lot.colorId, itemType,
            partName: partName?.slice(0, 500) ?? null, colorName: colorName?.slice(0, 100) ?? null,
            categoryId: lot.categoryId ?? null,
          },
        })
        partLookup.set(partKey, part)
      } else if ((!part.partName && partName) || (part.categoryId == null && lot.categoryId != null)) {
        part = await prisma.part.update({
          where: { id: part.id },
          data: {
            partName: part.partName || partName?.slice(0, 500) || null,
            colorName: part.colorName || colorName?.slice(0, 100) || null,
            categoryId: part.categoryId ?? lot.categoryId ?? null,
          },
        })
        partLookup.set(partKey, part)
      }

      const want = {
        partId: part.id,
        newOrUsed,
        completeness: mapCompleteness(itemType, lot.completeness),
        myPrice: lot.price ?? null,
        myQuantity: lot.quantity ?? 0,
        myCost: lot.cost ?? null,
        description: lot.description ? decodeHtmlEntities(lot.description) : null,
        remarks: lot.remarks ? decodeHtmlEntities(lot.remarks) : null,
      }
      // saleRate nur uebernehmen wenn hb-tool ihn liefert (fuehrt aktuell keinen Rabatt)
      const saleRate = typeof lot.saleRate === 'number' && lot.saleRate >= 0 && lot.saleRate <= 99
        ? Math.round(lot.saleRate) : undefined

      if (ex) {
        const oldQty = ex.myQuantity ?? 0
        const qtyChanged = want.myQuantity !== oldQty
        const priceChanged = !sameNum(want.myPrice, num(ex.myPrice))
        const otherChanged =
          want.partId !== ex.partId || want.newOrUsed !== ex.newOrUsed ||
          want.completeness !== (ex.completeness ?? null) ||
          !sameNum(want.myCost, num(ex.myCost)) ||
          want.description !== (ex.description ?? null) || want.remarks !== (ex.remarks ?? null) ||
          (saleRate !== undefined && saleRate !== ex.saleRate)
        if (!qtyChanged && !priceChanged && !otherChanged) continue

        await prisma.userWatchlist.update({
          where: { id: ex.id },
          data: {
            ...want,
            ...(saleRate !== undefined ? { saleRate } : {}),
            prevQuantity: oldQty,
            changedAt: qtyChanged || priceChanged ? new Date() : ex.changedAt,
          },
        })
        changedIds.push(ex.id)
        updated++
      } else {
        const created = await prisma.userWatchlist.create({
          data: { userId, blInventoryId: lot.blLotId, ...want, ...(saleRate !== undefined ? { saleRate } : {}) },
        })
        changedIds.push(created.id)
        added++
      }
    } catch (err) {
      errors++
      if (errors <= 5) console.error(`[hbtool-sync] Lot ${lot.blLotId}:`, err instanceof Error ? err.message : err)
    }
  }

  const removed = await prisma.userWatchlist.deleteMany({
    where: { userId, blInventoryId: { not: null, notIn: Array.from(seen) } },
  })

  if (changedIds.length > BATCH_RECOMPUTE_THRESHOLD) {
    await recomputeAllLotsForUser(userId)
  } else {
    for (const id of changedIds) await recomputeLotPricing(id)
  }

  // ETag erst nach erfolgreichem Abgleich merken — bei Fehlern kommt beim
  // naechsten Lauf die volle Liste und der Abgleich wird wiederholt.
  await prisma.user.update({
    where: { id: userId },
    data: {
      hbtoolInventoryEtag: errors === 0 ? (res.headers.get('etag') ?? null) : null,
      hbtoolLastInventoryAt: new Date(),
    },
  })

  return { notModified: false, totalLots: lots.length, added, updated, removed: removed.count, skipped }
}

// ---------------------------------------------------------------------------
// Bestellungen
// ---------------------------------------------------------------------------

export interface HbtoolOrdersResult {
  ordersSeen: number
  ordersWritten: number
  ordersUnchanged: number
  ordersRemoved: number
  itemsSkipped: number
  pages: number
}

export async function syncOrdersFromHbtool(
  userId: number,
  source: HbtoolSource,
  opts: { fromStart?: boolean } = {},
): Promise<HbtoolOrdersResult> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { hbtoolOrdersCursor: true } })
  let cursor = (!opts.fromStart && user?.hbtoolOrdersCursor) || ORDERS_START
  const result: HbtoolOrdersResult = { ordersSeen: 0, ordersWritten: 0, ordersUnchanged: 0, ordersRemoved: 0, itemsSkipped: 0, pages: 0 }
  const partCache = new Map<string, number | null>()

  for (let page = 0; page < ORDERS_MAX_PAGES; page++) {
    const res = await hbtoolGet(
      source,
      `/api/tracker/orders?changedSince=${encodeURIComponent(cursor)}&limit=${ORDERS_PAGE_LIMIT}`,
    )
    const data = await res.json() as { orders?: HbtoolOrder[]; hasMore?: boolean }
    if (!Array.isArray(data.orders)) throw new HbtoolError('Bestell-Antwort enthält keine Liste')
    result.pages++

    for (const order of data.orders) {
      result.ordersSeen++
      const r = await applyOrder(userId, order, partCache)
      result.itemsSkipped += r.skipped
      if (r.status === 'written') result.ordersWritten++
      else if (r.status === 'unchanged') result.ordersUnchanged++
      else if (r.status === 'removed') result.ordersRemoved++
    }

    const last = data.orders[data.orders.length - 1]?.changedAt
    const advanced = !!last && last !== cursor
    if (last) {
      cursor = last
      await prisma.user.update({ where: { id: userId }, data: { hbtoolOrdersCursor: cursor } })
    }
    if (!data.hasMore) break
    if (!advanced) {
      console.warn(`[hbtool-sync] Bestell-Cursor kommt nicht voran (${cursor}), Abbruch`)
      break
    }
  }

  await prisma.user.update({ where: { id: userId }, data: { hbtoolLastOrdersAt: new Date() } })
  return result
}

async function resolvePartId(item: HbtoolOrderItem, cache: Map<string, number | null>): Promise<number | null> {
  const key = `${item.itemNo}:${item.colorId}:${item.itemType ?? ''}`
  if (cache.has(key)) return cache.get(key)!
  let id: number | null = null
  if (item.itemType && BL_TYPES.has(item.itemType)) {
    id = await findOrCreatePart(item.itemNo, item.colorId, item.itemType, '', '')
  } else {
    id = (await findPart(item.itemNo, item.colorId))?.id ?? null
  }
  cache.set(key, id)
  return id
}

interface ApplyResult {
  status: 'written' | 'unchanged' | 'removed' | 'ignored'
  skipped: number
}

/** Ersetzt alle my_sales-Zeilen einer Bestellung (nur wenn sich etwas geaendert hat). */
async function applyOrder(
  userId: number,
  order: HbtoolOrder,
  partCache: Map<string, number | null>,
): Promise<ApplyResult> {
  const platform = MARKETS[(order.market ?? '').toLowerCase()] ?? null
  const orderId = typeof order.orderId === 'string' ? order.orderId.trim() : ''
  if (!platform || !orderId) return { status: 'ignored', skipped: 0 }

  const deleteSql = `DELETE FROM my_sales WHERE user_id = $1 AND platform = $2 AND order_id = $3`
  const notASale = order.cancelled || order.test === true || (order.currency != null && order.currency !== 'EUR')
  if (notASale) {
    const n = await prisma.$executeRawUnsafe(deleteSql, userId, platform, orderId)
    if (order.currency != null && order.currency !== 'EUR') {
      console.warn(`[hbtool-sync] Bestellung ${platform} ${orderId} in ${order.currency} übersprungen`)
    }
    return { status: n > 0 ? 'removed' : 'ignored', skipped: 0 }
  }

  const soldAt = new Date(order.orderedAt ?? order.changedAt ?? Date.now())
  // Gleiche Position (Teil+Zustand+Preis) aus mehreren Lots zusammenfassen — der
  // Unique-Index von my_sales wuerde sie sonst als Duplikat schlucken.
  const rows = new Map<string, { partId: number; cond: string; price: number; qty: number }>()
  let skipped = 0
  for (const item of order.items ?? []) {
    const cond = item.condition === 'N' || item.condition === 'U' ? item.condition : null
    const qty = (item.quantity ?? 0) - (item.refundedQuantity ?? 0)
    if (!cond || !item.itemNo || qty <= 0 || item.unitPrice == null || item.unitPrice < 0) { skipped++; continue }
    const partId = await resolvePartId(item, partCache)
    if (!partId) { skipped++; continue }
    const k = `${partId}:${cond}:${item.unitPrice}`
    const r = rows.get(k)
    if (r) r.qty += qty
    else rows.set(k, { partId, cond, price: item.unitPrice, qty })
  }

  // Unveraendert? (die letzte Bestellung kommt wegen der Ueberschneidung jedes Mal mit)
  const current = await prisma.$queryRawUnsafe<Array<{ part_id: number; new_or_used: string; quantity: number; unit_price: string; sold_at: Date }>>(
    `SELECT part_id, new_or_used, quantity, unit_price::text, sold_at FROM my_sales
     WHERE user_id = $1 AND platform = $2 AND order_id = $3`,
    userId, platform, orderId,
  )
  const sig = (xs: Array<{ partId: number; cond: string; qty: number; price: number; at: number }>) =>
    xs.map(x => `${x.partId}|${x.cond}|${x.qty}|${x.price.toFixed(4)}|${x.at}`).sort().join(';')
  const before = sig(current.map(c => ({ partId: c.part_id, cond: c.new_or_used, qty: c.quantity, price: Number(c.unit_price), at: c.sold_at.getTime() })))
  const after = sig(Array.from(rows.values()).map(r => ({ partId: r.partId, cond: r.cond, qty: r.qty, price: r.price, at: soldAt.getTime() })))
  if (before === after) return { status: 'unchanged', skipped }

  await prisma.$transaction([
    prisma.$executeRawUnsafe(deleteSql, userId, platform, orderId),
    ...Array.from(rows.values()).map(r => prisma.$executeRawUnsafe(
      `INSERT INTO my_sales (user_id, part_id, new_or_used, quantity, unit_price, sold_at, platform, order_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      userId, r.partId, r.cond, r.qty, r.price, soldAt, platform, orderId,
    )),
  ])
  return { status: 'written', skipped }
}

// ---------------------------------------------------------------------------
// Beides zusammen (Scheduler + "Jetzt abrufen")
// ---------------------------------------------------------------------------

export interface HbtoolSyncResult {
  inventory: HbtoolInventoryResult | null
  orders: HbtoolOrdersResult | null
  error: string | null
  /** BL-Kontingent-Zuteilung; null = hb-tool hat den Endpunkt (noch) nicht */
  budget?: HbtoolBudget | null
  budgetError?: string | null
}

export async function runHbtoolSync(
  userId: number,
  opts: { force?: boolean; ordersFromStart?: boolean } = {},
): Promise<HbtoolSyncResult> {
  const source = await loadUserHbtoolSource(userId)
  if (!source) return { inventory: null, orders: null, error: 'hb-tool ist nicht eingerichtet' }

  const errors: string[] = []
  let inventory: HbtoolInventoryResult | null = null
  let orders: HbtoolOrdersResult | null = null
  try {
    inventory = await syncInventoryFromHbtool(userId, source, { force: opts.force })
  } catch (err) {
    errors.push(`Inventar: ${err instanceof Error ? err.message : String(err)}`)
  }
  try {
    orders = await syncOrdersFromHbtool(userId, source, { fromStart: opts.ordersFromStart })
  } catch (err) {
    errors.push(`Bestellungen: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Kontingent-Zuteilung: Fehler hier sind nicht fatal (alte Zuteilung gilt
  // bis validUntil, danach Notwert) und landen nicht in hbtoolLastError.
  let budget: HbtoolBudget | null = null
  let budgetError: string | null = null
  try {
    budget = await fetchHbtoolBudget(userId, source)
  } catch (err) {
    budgetError = err instanceof Error ? err.message : String(err)
  }

  const error = errors.length > 0 ? errors.join(' · ') : null
  await prisma.user.update({ where: { id: userId }, data: { hbtoolLastError: error } })
  return { inventory, orders, error, budget, budgetError }
}
