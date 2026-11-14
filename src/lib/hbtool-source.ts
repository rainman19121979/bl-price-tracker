import { prisma } from './db'
import { decrypt } from './encryption'

// ---------------------------------------------------------------------------
// hb-tool als Quelle fuer Inventar + Bestellungen.
// hb-tool liefert nur aus (GET /api/tracker/inventory, /api/tracker/orders),
// Zugang per Bearer-Token. Spezifikation: Vault "BL Price Tracker /
// Schnittstelle hb-tool".
// ---------------------------------------------------------------------------

export interface HbtoolSource {
  url: string   // ohne abschliessenden Slash, z.B. http://localhost:8100
  token: string
}

const TIMEOUT_MS = 60_000

export function normalizeHbtoolUrl(raw: string): string | null {
  const t = raw.trim().replace(/\/+$/, '')
  try {
    const u = new URL(t)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return t
  } catch {
    return null
  }
}

/** Lädt URL + Token des Users. null = hb-tool nicht konfiguriert. */
export async function loadUserHbtoolSource(userId: number): Promise<HbtoolSource | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { hbtoolUrl: true, hbtoolTokenEnc: true },
  })
  if (!u?.hbtoolUrl || !u.hbtoolTokenEnc) return null
  try {
    return { url: u.hbtoolUrl, token: decrypt(Buffer.from(u.hbtoolTokenEnc)) }
  } catch {
    return null
  }
}

export class HbtoolError extends Error {
  constructor(message: string, public status?: number) {
    super(message)
  }
}

/** GET gegen hb-tool. Liefert die Response (auch 304); wirft bei Netzwerk-/HTTP-Fehler. */
export async function hbtoolGet(
  source: HbtoolSource,
  path: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(source.url + path, {
      headers: { Authorization: `Bearer ${source.token}`, Accept: 'application/json', ...headers },
      signal: ctrl.signal,
      cache: 'no-store',
    })
  } catch (err) {
    const msg = err instanceof Error && err.name === 'AbortError'
      ? `hb-tool antwortet nicht (Timeout ${TIMEOUT_MS / 1000}s)`
      : `hb-tool nicht erreichbar: ${err instanceof Error ? err.message : String(err)}`
    throw new HbtoolError(msg)
  } finally {
    clearTimeout(timer)
  }
  if (res.status === 304 || res.ok) return res
  if (res.status === 401) throw new HbtoolError('hb-tool lehnt den Schlüssel ab (401)', 401)
  let detail = ''
  try { detail = ((await res.json()) as { error?: string }).error ?? '' } catch { /* ignore */ }
  throw new HbtoolError(`hb-tool HTTP ${res.status}${detail ? `: ${detail}` : ''}`, res.status)
}

/** Verbindungstest: holt das Inventar (ohne ETag) und zählt Lots. Schreibt nichts. */
export async function testHbtool(source: HbtoolSource): Promise<{ ok: true; lots: number } | { ok: false; error: string }> {
  try {
    const res = await hbtoolGet(source, '/api/tracker/inventory')
    const data = await res.json() as { count?: number; lots?: unknown[] }
    if (!Array.isArray(data.lots)) return { ok: false, error: 'Antwort enthält keine Lot-Liste' }
    return { ok: true, lots: data.lots.length }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
