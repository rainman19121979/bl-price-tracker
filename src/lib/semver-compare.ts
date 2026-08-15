/**
 * Minimaler Semver-Vergleich fuer die Update-Anzeige.
 *
 * Kein npm-`semver`-Package -- 100 KB Overhead fuer drei Zahlen ist unnoetig.
 * Toleriert fuehrendes 'v' und Suffixe (z.B. "1.2.3-beta.1" wird als "1.2.3"
 * behandelt -- Pre-Release-Sortierung ist fuer unseren Use-Case irrelevant).
 */

interface ParsedVersion {
  major: number
  minor: number
  patch: number
}

function parseVersion(input: string): ParsedVersion | null {
  const stripped = input.replace(/^v/i, '').split(/[-+]/)[0]
  const parts = stripped.split('.')
  if (parts.length < 1) return null
  const major = parseInt(parts[0] ?? '0', 10)
  const minor = parseInt(parts[1] ?? '0', 10)
  const patch = parseInt(parts[2] ?? '0', 10)
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) return null
  return { major, minor, patch }
}

/**
 * Returns true wenn `latest` eine hoehere Version als `current` ist.
 * Bei ungueltigen Inputs immer false (nie ein Update anzeigen wenn wir uns
 * nicht sicher sind).
 */
export function isVersionNewer(latest: string, current: string): boolean {
  const l = parseVersion(latest)
  const c = parseVersion(current)
  if (!l || !c) return false
  if (l.major !== c.major) return l.major > c.major
  if (l.minor !== c.minor) return l.minor > c.minor
  return l.patch > c.patch
}
