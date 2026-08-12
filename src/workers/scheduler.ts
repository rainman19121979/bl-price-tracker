import { prisma } from '@/lib/db'
import { getLastSyncDate, setLastSyncDate } from '@/lib/crawler-control'
import { cleanupOldLogs } from '@/lib/api-usage'
import { importBsxDirectory } from '@/lib/bsx-orders'
import { syncBricklinkInventory } from '@/lib/inventory-sync'

// ---------------------------------------------------------------------------
// Auto-Sync: Sync BrickLink inventory for users with autoSyncInventory=true.
// Uses the shared helper — my_sales are sourced exclusively from BSX-Import,
// NOT from quantity-diffs (that path produced duplicates).
// ---------------------------------------------------------------------------

async function autoSyncInventories(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { autoSyncInventory: true, isActive: true },
    select: { id: true },
  })

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
async function checkBsxOrders(): Promise<void> {
  // Only check once per 30 minutes
  if (Date.now() - lastBsxCheck < 30 * 60 * 1000) return
  lastBsxCheck = Date.now()

  const users = await prisma.user.findMany({
    where: { isActive: true, bsxOrdersDir: { not: null } },
    select: { id: true, bsxOrdersDir: true },
  })

  for (const user of users) {
    if (!user.bsxOrdersDir) continue
    try {
      const result = await importBsxDirectory(user.bsxOrdersDir, user.id)
      if (result.itemsImported > 0 || result.partsCreated > 0 || result.errors.length > 0) {
        console.log(`[Scheduler] BSX-Orders user=${user.id}: ${result.ordersProcessed} Dateien, ${result.itemsImported} neue Items, ${result.itemsSkipped} bereits da, ${result.partsCreated} Parts neu, ${result.errors.length} Fehler`)
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
      await autoSyncInventories()

      // Cleanup old API call log entries (>48h)
      const cleaned = await cleanupOldLogs()
      if (cleaned > 0) console.log(`[Scheduler] Cleanup: ${cleaned} alte API-Log-Einträge entfernt`)

      // Import new BSX order files (read-only scan, dedup via UNIQUE INDEX)
      await checkBsxOrders()
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
