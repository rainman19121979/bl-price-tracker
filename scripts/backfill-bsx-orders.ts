import { importBsxSource } from '../src/lib/bsx-orders'
import { loadUserBsxSource } from '../src/lib/bsx-source'
import { prisma } from '../src/lib/db'

// Usage:
//   npx tsx scripts/backfill-bsx-orders.ts [user-id]              -- use configured source
//   npx tsx scripts/backfill-bsx-orders.ts [user-id] [orders-dir] -- override to a local dir
async function main() {
  const userIdArg = parseInt(process.argv[2] || '1')
  const dirOverride = process.argv[3]

  const source = dirOverride
    ? { type: 'local' as const, dir: dirOverride }
    : await loadUserBsxSource(userIdArg)

  if (!source) {
    console.error(`Keine BSX-Quelle für user id=${userIdArg}. Konfiguriere sie unter Settings oder`)
    console.error(`übergib einen lokalen Pfad: npx tsx scripts/backfill-bsx-orders.ts 1 /pfad/zu/orders`)
    process.exit(1)
  }

  console.log(`[Backfill] Lese ${source.type}-Quelle für user id=${userIdArg} (read-only)…`)
  const start = Date.now()
  const result = await importBsxSource(source, userIdArg)
  const sec = ((Date.now() - start) / 1000).toFixed(1)

  console.log(`[Backfill] Fertig in ${sec}s`)
  console.log(`  Orders verarbeitet: ${result.ordersProcessed}`)
  console.log(`  Items importiert:   ${result.itemsImported}`)
  console.log(`  Items uebersprungen: ${result.itemsSkipped} (bereits in DB)`)
  console.log(`  Parts neu angelegt: ${result.partsCreated}`)
  if (result.errors.length > 0) {
    console.log(`  Fehler: ${result.errors.length}`)
    for (const e of result.errors.slice(0, 10)) console.log(`    - ${e.file}: ${e.error}`)
  }

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
