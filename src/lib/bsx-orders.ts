import { parseStringPromise } from 'xml2js'
import { prisma } from './db'
import { decodeHtmlEntities } from './html-entities'
import { listOrderFiles, readOrderFile, type BsxSource } from './bsx-source'

const ITEM_TYPE_MAP: Record<string, string> = {
  P: 'PART',
  M: 'MINIFIG',
  S: 'SET',
  G: 'GEAR',
  B: 'BOOK',
  C: 'CATALOG',
  I: 'INSTRUCTION',
  O: 'ORIGINAL_BOX',
}

export interface ParsedOrder {
  service: string  // BrickLink | BrickOwl
  orderId: string
  orderDate: Date
  customer: string | null
  currency: string
  items: ParsedOrderItem[]
}

export interface ParsedOrderItem {
  partNo: string
  itemType: string  // PART/MINIFIG/...
  colorId: number
  itemName: string
  colorName: string
  quantity: number
  price: number
  condition: 'N' | 'U'
}

interface BsxXml {
  BrickStoreXML: {
    Order?: Array<{
      Service: string[]; OrderID: string[]; OrderDate: string[];
      Customer?: string[]; Currency?: string[]
    }>
    Inventory?: Array<{ Item: BsxItem[] }>
  }
}

interface BsxItem {
  ItemID: string[]
  ItemTypeID: string[]
  ColorID: string[]
  ItemName?: string[]
  ColorName?: string[]
  Qty: string[]
  Price: string[]
  Condition?: string[]
}

export async function parseBsxContent(raw: string): Promise<ParsedOrder | null> {
  const parsed: BsxXml = await parseStringPromise(raw)
  const order = parsed.BrickStoreXML?.Order?.[0]
  if (!order) return null

  const items: ParsedOrderItem[] = []
  const inv = parsed.BrickStoreXML?.Inventory?.[0]?.Item ?? []
  for (const it of inv) {
    const typeCode = it.ItemTypeID?.[0]?.toUpperCase()
    const itemType = ITEM_TYPE_MAP[typeCode] ?? 'PART'
    const condition = (it.Condition?.[0] === 'N' ? 'N' : 'U') as 'N' | 'U'
    items.push({
      partNo: it.ItemID[0],
      itemType,
      colorId: parseInt(it.ColorID[0] ?? '0'),
      itemName: decodeHtmlEntities(it.ItemName?.[0] ?? ''),
      colorName: decodeHtmlEntities(it.ColorName?.[0] ?? ''),
      quantity: parseInt(it.Qty[0]),
      price: parseFloat(it.Price[0]),
      condition,
    })
  }

  // OrderDate is a Unix timestamp (seconds) from BrickSync, or an ISO-8601
  // string from BrickStore. Try both — fall back to now() so we don't insert
  // Invalid Date silently.
  const rawDate = order.OrderDate[0]
  let orderDate: Date
  if (/^\d+$/.test(rawDate)) {
    orderDate = new Date(parseInt(rawDate, 10) * 1000)
  } else {
    orderDate = new Date(rawDate)
  }
  if (isNaN(orderDate.getTime())) {
    console.warn(`[bsx-orders] Bad OrderDate "${rawDate}" — using now()`)
    orderDate = new Date()
  }

  return {
    service: order.Service[0],
    orderId: order.OrderID[0],
    orderDate,
    customer: order.Customer?.[0] ?? null,
    currency: order.Currency?.[0] ?? 'EUR',
    items,
  }
}

/**
 * Find or create a part. If created, only minimal fields are populated.
 * Returns the part.id.
 */
export async function findOrCreatePart(partNo: string, colorId: number, itemType: string, partName: string, colorName: string): Promise<number> {
  let part = await prisma.part.findUnique({
    where: { partNo_colorId_itemType: { partNo, colorId, itemType } },
  })
  if (part) return part.id

  part = await prisma.part.create({
    data: {
      partNo, colorId, itemType,
      partName: partName.slice(0, 250),
      colorName: colorName.slice(0, 100),
    },
  })
  return part.id
}

export interface ImportResult {
  ordersProcessed: number
  itemsImported: number
  itemsSkipped: number
  partsCreated: number
  errors: Array<{ file: string; error: string }>
}

/**
 * Import all BSX files from a source (local dir or SMB share). Idempotent
 * (relies on UNIQUE INDEX). `userId` is the user the orders belong to.
 */
export async function importBsxSource(source: BsxSource, userId: number): Promise<ImportResult> {
  const result: ImportResult = {
    ordersProcessed: 0, itemsImported: 0, itemsSkipped: 0, partsCreated: 0, errors: [],
  }

  const bsxFiles = await listOrderFiles(source)

  for (const file of bsxFiles) {
    try {
      const buf = await readOrderFile(source, file)
      const order = await parseBsxContent(buf.toString('utf-8'))
      if (!order) continue

      const platform = order.service === 'BrickOwl' ? 'BO' : 'BL'

      for (const item of order.items) {
        try {
          // Determine if we need to create the part
          const existing = await prisma.part.findUnique({
            where: { partNo_colorId_itemType: { partNo: item.partNo, colorId: item.colorId, itemType: item.itemType } },
            select: { id: true },
          })
          let partId: number
          if (existing) {
            partId = existing.id
          } else {
            partId = await findOrCreatePart(item.partNo, item.colorId, item.itemType, item.itemName, item.colorName)
            result.partsCreated++
          }

          // Insert into my_sales (ON CONFLICT DO NOTHING via unique index)
          const inserted = await prisma.$executeRawUnsafe(
            `INSERT INTO my_sales (user_id, part_id, new_or_used, quantity, unit_price, sold_at, platform, order_id, customer)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (user_id, platform, order_id, part_id, new_or_used, unit_price, quantity) DO NOTHING`,
            userId, partId, item.condition, item.quantity, item.price, order.orderDate, platform, order.orderId, order.customer
          )
          if (inserted > 0) result.itemsImported++
          else result.itemsSkipped++
        } catch (err) {
          result.errors.push({ file: `${file}#${item.partNo}/${item.colorId}`, error: err instanceof Error ? err.message : String(err) })
        }
      }
      result.ordersProcessed++
    } catch (err) {
      result.errors.push({ file, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return result
}
