import { redis } from './redis'

const CRAWLER_ACTIVE_KEY = 'crawler:active'
const SYNC_LAST_RUN_PREFIX = 'sync:lastrun:'

export async function isCrawlerActive(): Promise<boolean> {
  const val = await redis.get(CRAWLER_ACTIVE_KEY)
  return val === '1'
}

export async function setCrawlerActive(active: boolean): Promise<void> {
  await redis.set(CRAWLER_ACTIVE_KEY, active ? '1' : '0')
}

export async function getLastSyncDate(userId: number): Promise<string | null> {
  return redis.get(`${SYNC_LAST_RUN_PREFIX}${userId}`)
}

export async function setLastSyncDate(userId: number): Promise<void> {
  await redis.set(
    `${SYNC_LAST_RUN_PREFIX}${userId}`,
    new Date().toISOString(),
    'EX',
    90 * 24 * 60 * 60
  )
}
