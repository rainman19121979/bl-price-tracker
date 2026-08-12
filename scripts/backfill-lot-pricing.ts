import { prisma } from '../src/lib/db'
import { recomputeAllLotsForUser } from '../src/lib/lot-pricing'

async function main() {
  const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true, username: true } })
  console.log(`[Backfill] ${users.length} aktive User`)

  for (const u of users) {
    const start = Date.now()
    const r = await recomputeAllLotsForUser(u.id)
    console.log(`[Backfill] User ${u.username} (${u.id}): ${r.updated} Lots in ${((Date.now() - start) / 1000).toFixed(1)}s`)
  }

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
