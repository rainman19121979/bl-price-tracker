import { redis } from './redis'

/**
 * Simple sliding-window rate limit backed by Redis INCR + EXPIRE.
 *
 * @param key    Unique bucket key (e.g. "auth:login:1.2.3.4")
 * @param limit  Max operations allowed inside the window
 * @param windowSec  Window length in seconds
 * @returns { ok, remaining, resetSec }  — ok=false → caller returns 429
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<{ ok: boolean; remaining: number; resetSec: number }> {
  const bucket = `rl:${key}`
  try {
    const count = await redis.incr(bucket)
    if (count === 1) {
      await redis.expire(bucket, windowSec)
    }
    const ttl = await redis.ttl(bucket)
    return {
      ok: count <= limit,
      remaining: Math.max(0, limit - count),
      resetSec: ttl > 0 ? ttl : windowSec,
    }
  } catch {
    // Fail-open: if Redis is down, don't block the request
    return { ok: true, remaining: limit, resetSec: windowSec }
  }
}

/**
 * Extract a client-IP-ish token from a Next.js Request.
 * Prefers x-forwarded-for (first hop), falls back to x-real-ip, then "unknown".
 * Not a security identity — only used as a rate-limit bucket key.
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const xri = req.headers.get('x-real-ip')
  if (xri) return xri.trim()
  return 'unknown'
}
