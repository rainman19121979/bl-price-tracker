import { prisma } from './db'

/**
 * Anzahl BL-Aufrufe, die fuer ueberfaellige Lots (sold oder stock aelter als
 * freshDays) noch fehlen. Pro (Teil, Zustand) einmal gezaehlt, weil ein
 * Abruf alle Lots desselben Teils abdeckt. SETs x3 (C/I/S).
 */
export async function countOverdueCalls(userIds: number[], freshDays: number): Promise<number> {
  const threshold = new Date(Date.now() - freshDays * 24 * 60 * 60 * 1000)
  const rows = await prisma.$queryRawUnsafe<[{ calls: number }]>(
    `SELECT COALESCE(SUM(
        ((CASE WHEN sold_ts IS NULL OR sold_ts < $2 THEN 1 ELSE 0 END)
       + (CASE WHEN stock_ts IS NULL OR stock_ts < $2 THEN 1 ELSE 0 END))
       * (CASE WHEN item_type = 'SET' THEN 3 ELSE 1 END)
     ), 0)::int AS calls
     FROM (
       SELECT DISTINCT p.id, w.new_or_used, p.item_type,
         CASE WHEN w.new_or_used = 'N' THEN p.last_sold_crawl_n ELSE p.last_sold_crawl_u END AS sold_ts,
         CASE WHEN w.new_or_used = 'N' THEN p.last_stock_crawl_n ELSE p.last_stock_crawl_u END AS stock_ts
       FROM user_watchlists w JOIN parts p ON p.id = w.part_id
       WHERE w.user_id = ANY($1::int[])
     ) x`,
    userIds, threshold,
  )
  return rows[0]?.calls ?? 0
}
