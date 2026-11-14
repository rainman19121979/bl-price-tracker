import { prisma } from '@/lib/db'
import { getLastSyncDate, setLastSyncDate } from '@/lib/crawler-control'
import { cleanupOldLogs } from '@/lib/api-usage'
import { importBsxSource } from '@/lib/bsx-orders'
import { loadUserBsxSource } from '@/lib/bsx-source'
import { syncBricklinkInventory } from '@/lib/inventory-sync'
import { runHbtoolSync } from '@/lib/hbtool-sync'

// User mit hb-tool-Quelle (URL + Token): Inventar + Bestellungen kommen von
// hb-tool, BL-Auto-Sync und BSX-Import werden fuer sie uebersprungen.
async function hbtoolUserIds(): Promise<Set<number>> {
  const users = await prisma.user.findMany({
    where: { isActive: true, hbtoolUrl: { not: null }, hbtoolTokenEnc: { not: null } },
    select: { id: true },
  })
  return new Set(users.map(u => u.id))
}

async function syncFromHbtool(userIds: Set<number>): Promise<void> {
  for (const userId of Array.from(userIds)) {
    const r = await runHbtoolSync(userId)
    const inv = r.inventory
    const ord = r.orders
    if (inv && !inv.notModified && (inv.added || inv.updated || inv.removed)) {
      console.log(`[hb-tool] User ${userId} Inventar: ${inv.totalLots} Lots, +${inv.added}, ~${inv.updated}, -${inv.removed}, ${inv.skipped} übersprungen`)
    }
    if (ord && (ord.ordersWritten || ord.ordersRemoved)) {
      console.log(`[hb-tool] User ${userId} Bestellungen: ${ord.ordersSeen} gesehen, ${ord.ordersWritten} geschrieben, ${ord.ordersRemoved} entfernt, ${ord.itemsSkipped} Positionen übersprungen`)
    }
    if (r.error) console.error(`[hb-tool] User ${userId}: ${r.error}`)
  }
}

// ---------------------------------------------------------------------------
// Auto-Sync: Sync BrickLink inventory for users with autoSyncInventory=true.
// Uses the shared helper — my_sales are sourced exclusively from BSX-Import,
// NOT from quantity-diffs (that path produced duplicates).
// ---------------------------------------------------------------------------

async function autoSyncInventories(skip: Set<number>): Promise<void> {
  const users = (await prisma.user.findMany({
    where: { autoSyncInventory: true, isActive: true },
    select: { id: true },
  })).filter(u => !skip.has(u.id))

  if (users.length === 0) return

  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

  for (const user of users) {
    const lastSync = await getLastSyncDate(user.id)
    if (lastSync && Date.now() - new Date(lastSync).getTime() < TWENTY_FOUR_HOURS_MS) continue

    try {
      const result = await syncBricklinkInventory(user.id)
      await setLastSyncDate(user.id)
      console.log(`[AutoSync] User ${user.id}: +${result.added}, ~${result.updated}, -${result.removed}`)
    } catch (err) {
      console.error(`[AutoSync] User ${user.id}: Fehler:`, err instanceof Error ? err.message : err)
    }
  }
}

// ---------------------------------------------------------------------------
// Main loop — runs every 5 minutes
// ---------------------------------------------------------------------------

let lastBsxCheck = 0

// BSX orders are imported per-user from the directory each user configured in Settings
// (read-only — files are NEVER modified or deleted)
async function checkBsxOrders(skip: Set<number>): Promise<void> {
  // Only check once per 30 minutes
  if (Date.now() - lastBsxCheck < 30 * 60 * 1000) return
  lastBsxCheck = Date.now()

  // Pick every active user — the source loader decides local vs. SMB
  // (returns null if the user has no BSX source configured, which we skip).
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true },
  })

  for (const user of users) {
    if (skip.has(user.id)) continue
    try {
      const source = await loadUserBsxSource(user.id)
      if (!source) continue
      const result = await importBsxSource(source, user.id)
      if (result.itemsImported > 0 || result.partsCreated > 0 || result.errors.length > 0) {
        console.log(`[Scheduler] BSX-Orders user=${user.id} src=${source.type}: ${result.ordersProcessed} Dateien, ${result.itemsImported} neue Items, ${result.itemsSkipped} bereits da, ${result.partsCreated} Parts neu, ${result.errors.length} Fehler`)
      }
    } catch (err) {
      console.error(`[Scheduler] BSX-Import Fehler user=${user.id}:`, err instanceof Error ? err.message : err)
    }
  }
}

async function schedulerLoop(): Promise<void> {
  console.log('[Scheduler] Gestartet')

  while (true) {
    try {
      const hbtoolUsers = await hbtoolUserIds()
      await syncFromHbtool(hbtoolUsers)
      await autoSyncInventories(hbtoolUsers)

      // Cleanup old API call log entries (>48h)
      const cleaned = await cleanupOldLogs()
      if (cleaned > 0) console.log(`[Scheduler] Cleanup: ${cleaned} alte API-Log-Einträge entfernt`)

      // Import new BSX order files (read-only scan, dedup via UNIQUE INDEX)
      await checkBsxOrders(hbtoolUsers)
    } catch (err) {
      console.error('[Scheduler] Fehler:', err instanceof Error ? err.message : err)
    }

    // Wait 5 minutes
    await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000))
  }
}

schedulerLoop().catch((err) => {
  console.error('[Scheduler] Fatal:', err)
  process.exit(1)
})

process.on('SIGTERM', async () => { console.log('[Scheduler] Beendet'); await prisma.$disconnect(); process.exit(0) })
process.on('SIGINT', async () => { console.log('[Scheduler] Beendet'); await prisma.$disconnect(); process.exit(0) })
