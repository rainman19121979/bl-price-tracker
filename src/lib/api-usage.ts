import { prisma } from '@/lib/db'

const WINDOW_MS = 24 * 60 * 60 * 1000 // 24 hours

/** Count API calls made by a specific key in the last 24 hours */
export async function getUsage(apiKeyId: number): Promise<number> {
  const since = new Date(Date.now() - WINDOW_MS)
  return prisma.apiCallLog.count({
    where: { apiKeyId, createdAt: { gte: since } },
  })
}

/** Count API calls across multiple keys in the last 24 hours */
export async function getUsageForKeys(apiKeyIds: number[]): Promise<number> {
  if (apiKeyIds.length === 0) return 0
  const since = new Date(Date.now() - WINDOW_MS)
  return prisma.apiCallLog.count({
    where: { apiKeyId: { in: apiKeyIds }, createdAt: { gte: since } },
  })
}

/** Per-key usage map: { keyId: count } */
export async function getUsageByKey(apiKeyIds: number[]): Promise<Map<number, number>> {
  if (apiKeyIds.length === 0) return new Map()
  const since = new Date(Date.now() - WINDOW_MS)
  const results = await prisma.apiCallLog.groupBy({
    by: ['apiKeyId'],
    where: { apiKeyId: { in: apiKeyIds }, createdAt: { gte: since } },
    _count: { id: true },
  })
  const map = new Map<number, number>()
  for (const r of results) map.set(r.apiKeyId, r._count.id)
  return map
}

/** Record one or more API calls */
export async function logApiCall(apiKeyId: number, count: number = 1): Promise<void> {
  if (count === 1) {
    await prisma.apiCallLog.create({ data: { apiKeyId } })
  } else {
    await prisma.apiCallLog.createMany({
      data: Array.from({ length: count }, () => ({ apiKeyId })),
    })
  }
}

/** Delete log entries older than 48 hours */
export async function cleanupOldLogs(): Promise<number> {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000)
  const result = await prisma.apiCallLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  })
  return result.count
}

/**
 * Estimated external BL calls (per day) for a user, based on the
 * externalCalls JSON on their API keys — pattern: [{interval: <seconds>}].
 * Users configure this in Settings to signal that a third-party tool
 * (e.g. BrickSync) is consuming the same BL key at a known cadence.
 * Returns 0 if nothing configured.
 */
export async function getExternalCallCount(userId?: number): Promise<number> {
  if (!userId) return 0
  const keys = await prisma.userApiKey.findMany({
    where: { userId, isValid: true },
    select: { externalCalls: true },
  })
  let total = 0
  for (const k of keys) {
    if (!k.externalCalls) continue
    try {
      const callers = JSON.parse(k.externalCalls) as { interval: number }[]
      total += callers.reduce(
        (sum, c) => sum + (c.interval > 0 ? Math.floor(86400 / c.interval) : 0),
        0,
      )
    } catch { /* ignore malformed */ }
  }
  return total
}
