-- Completeness für SET-Items: BrickLink hat drei Werte
--   'C' = complete (kompletter Bausatz, alle Teile da)
--   'I' = incomplete (unvollständig)
--   'S' = sealed (noch versiegelt in OVP)
-- Bei PART / MINIFIG ist das Feld NULL.
--
-- Neue Spalte auf 3 Tabellen: user_watchlists, price_sales, price_stock.
-- Aggregations-Queries müssen bei SETs zusätzlich zu (part_id, new_or_used)
-- auch nach completeness filtern — sealed hat oft 2-5× den Preis von used.

ALTER TABLE "user_watchlists" ADD COLUMN IF NOT EXISTS "completeness" CHAR(1);
ALTER TABLE "price_sales" ADD COLUMN IF NOT EXISTS "completeness" CHAR(1);
ALTER TABLE "price_stock" ADD COLUMN IF NOT EXISTS "completeness" CHAR(1);

-- Composite-Indizes für die neuen Filter-Kombinationen
CREATE INDEX IF NOT EXISTS "idx_sales_part_new_comp_date"
  ON "price_sales" ("part_id", "new_or_used", "completeness", "date_ordered" DESC);
CREATE INDEX IF NOT EXISTS "idx_stock_part_new_comp_date"
  ON "price_stock" ("part_id", "new_or_used", "completeness", "fetched_at" DESC);
