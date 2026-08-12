import { importBsxDirectory } from '../src/lib/bsx-orders'
import { prisma } from '../src/lib/db'

// Usage: npx tsx scripts/backfill-bsx-orders.ts [orders-dir] [user-id]
// Defaults: use the bsxOrdersDir configured in Settings for user id=1
async function main() {
  const dirArg = process.argv[2]
  const userIdArg = parseInt(process.argv[3] || '1')

  let ordersDir = dirArg
  if (!ordersDir) {
    const user = await prisma.user.findUnique({ where: { id: userIdArg }, select: { bsxOrdersDir: true } })
    ordersDir = user?.bsxOrdersDir ?? ''
    if (!ordersDir) {
      console.error(`Kein bsxOrdersDir für user id=${userIdArg} konfiguriert. Übergib den Pfad als 1. Argument, z.B.:`)
      console.error(`  npx tsx scripts/backfill-bsx-orders.ts /pfad/zu/bricksync/orders 1`)
      process.exit(1)
    }
  }

  console.log(`[Backfill] Lese ${ordersDir} für user id=${userIdArg} (read-only)…`)
  const start = Date.now()
  const result = await importBsxDirectory(ordersDir, userIdArg)
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
