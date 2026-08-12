import { prisma } from './db'

const TYPE_PRIORITY = ['PART', 'MINIFIG', 'SET']

/**
 * Find a part by partNo + colorId, trying PART → MINIFIG → SET.
 * Single DB query instead of up to 3 sequential ones.
 */
export async function findPart(partNo: string, colorId: number) {
  const parts = await prisma.part.findMany({
    where: { partNo, colorId },
    take: 3,
  })
  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0]
  return parts.sort((a, b) => TYPE_PRIORITY.indexOf(a.itemType) - TYPE_PRIORITY.indexOf(b.itemType))[0]
}
