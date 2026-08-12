import type { Session } from "next-auth";

/**
 * Extract the numeric user id from a NextAuth session.
 * Session.user.id is a stringified number (see auth.ts:37, `id: String(user.id)`).
 * Returns null if the id is missing, non-numeric, or non-integer — caller
 * should treat null as "unauthenticated / invalid session" and reject.
 */
export function getUserId(session: Session | null | undefined): number | null {
  const raw = session?.user?.id;
  if (typeof raw !== "string" || raw.length === 0) return null;
  // Match the exact shape auth.ts produces: a base-10 positive integer.
  if (!/^[1-9][0-9]*$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
