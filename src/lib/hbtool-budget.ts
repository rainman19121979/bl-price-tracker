import { prisma } from './db'
import { redis } from './redis'
import { hbtoolGet, HbtoolError, type HbtoolSource } from './hbtool-source'

// ---------------------------------------------------------------------------
// Gemeinsames BL-Kontingent, verwaltet von hb-tool.
// hb-tool und Tracker nutzen denselben BL-Schluessel (5.000/24h rollierend).
// hb-tool teilt dem Tracker per GET /api/tracker/budget zu, wie viele Aufrufe
// er in seinem rollierenden 24h-Fenster haben darf. Spezifikation: Vault
// "BL Price Tracker / Schnittstelle hb-tool", Abschnitt 3.
//
// Solange hb-tool den Endpunkt nicht hat (404), bleibt alles beim manuell
// eingetragenen Limit + geschaetzten externen Aufrufern.
// ---------------------------------------------------------------------------

export const FALLBACK_GRANT = 300           // Notwert, wenn die Zuteilung abgelaufen ist
const DEFAULT_VALID_MS = 2 * 60 * 60 * 1000 // falls hb-tool kein validUntil liefert
const STORE_TTL_S = 7 * 24 * 60 * 60        // "hatte schon mal eine Zuteilung" merken

export interface HbtoolBudget {
  accountLimit: number | null
  hbtoolUsed24h: number | null
  trackerUsed24h: number
  totalUsed24h: number | null
  trackerGrant24h: number
  validUntil: string
  reason: string | null
  fetchedAt: string
}

export interface EffectiveBudget extends HbtoolBudget {
  /** Was der Tracker gerade darf: Zuteilung oder Notwert. */
  effectiveGrant: number
  expired: boolean
}

const key = (userId: number) => `hbtool:budget:${userId}`

async function trackerUsed24h(userId: number): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  return prisma.apiCallLog.count({ where: { createdAt: { gte: since }, apiKey: { userId } } })
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null

/**
 * Holt die Zuteilung von hb-tool und legt sie in Redis ab (Crawler liest dort).
 * Rueckgabe: die neue Zuteilung, null wenn hb-tool den Endpunkt (noch) nicht hat.
 * Wirft bei anderen Fehlern -- die alte Zuteilung bleibt dann bis validUntil gueltig.
 */
export async function fetchHbtoolBudget(userId: number, source: HbtoolSource): Promise<HbtoolBudget | null> {
  const used = await trackerUsed24h(userId)
  let res: Response
  try {
    res = await hbtoolGet(source, `/api/tracker/budget?trackerUsed24h=${used}`)
  } catch (err) {
    if (err instanceof HbtoolError && err.status === 404) return null
    throw err
  }
  const d = await res.json() as Record<string, unknown>
  const grant = num(d.trackerGrant24h)
  if (grant === null) throw new HbtoolError('Budget-Antwort ohne gueltiges trackerGrant24h')

  const vu = typeof d.validUntil === 'string' ? Date.parse(d.validUntil) : NaN
  const budget: HbtoolBudget = {
    accountLimit: num(d.accountLimit),
    hbtoolUsed24h: num(d.hbtoolUsed24h),
    trackerUsed24h: used,
    totalUsed24h: num(d.totalUsed24h),
    trackerGrant24h: grant,
    validUntil: new Date(Number.isFinite(vu) ? vu : Date.now() + DEFAULT_VALID_MS).toISOString(),
    reason: typeof d.reason === 'string' ? d.reason.slice(0, 60) : null,
    fetchedAt: new Date().toISOString(),
  }
  await redis.set(key(userId), JSON.stringify(budget), 'EX', STORE_TTL_S)
  return budget
}

/** Zuteilung fuer den User, oder null = keine hb-tool-Zuteilung (manuelles Limit gilt). */
export async function getEffectiveBudget(userId: number): Promise<EffectiveBudget | null> {
  let raw: string | null
  try {
    raw = await redis.get(key(userId))
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const b = JSON.parse(raw) as HbtoolBudget
    const expired = Date.parse(b.validUntil) <= Date.now()
    return { ...b, expired, effectiveGrant: expired ? Math.min(FALLBACK_GRANT, b.trackerGrant24h) : b.trackerGrant24h }
  } catch {
    return null
  }
}

/** Beim Abschalten der hb-tool-Quelle: Zuteilung vergessen, manuelles Limit gilt wieder. */
export async function clearHbtoolBudget(userId: number): Promise<void> {
  try { await redis.del(key(userId)) } catch { /* ignore */ }
}
