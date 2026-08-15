-- Dedup-Indizes um `completeness` (und `seller_country` bei stock) erweitern.
--
-- Vorher: idx_sales_dedup / idx_stock_dedup enthielten kein `completeness`.
-- Beim Import gemergter Datensaetze (Preisdaten-Export/Import) haette
-- ON CONFLICT DO NOTHING zwei Sales als Duplikat behandelt, die sich nur
-- in `completeness` unterscheiden -- z.B. ein SET Sealed vs. Complete
-- am gleichen Tag zum gleichen Preis in der gleichen Menge an den gleichen
-- Kaeufer-Country. Der eine wuerde faelschlich gedroppt.
--
-- Zusaetzlich: fuer completeness=NULL (bei PART/MINIFIG) muss NULLS NOT
-- DISTINCT gelten, sonst wuerden zwei sonst identische Non-SET-Zeilen mit
-- beide NULL nicht als Duplikat matchen und ins Dedup-Loch fallen.
--
-- Postgres 15+ unterstuetzt NULLS NOT DISTINCT direkt in Unique-Indexes
-- (docker-compose fixiert postgres:15-alpine).
--
-- Bestehender Crawler-Code (fetch-prices.ts, workers/crawler.ts) schreibt
-- `completeness` bereits mit -- funktioniert unveraendert mit dem neuen
-- Index.

DROP INDEX IF EXISTS idx_sales_dedup;
CREATE UNIQUE INDEX idx_sales_dedup
  ON price_sales (part_id, date_ordered, unit_price, quantity, buyer_country,
                  new_or_used, seller_country, completeness)
  NULLS NOT DISTINCT;

DROP INDEX IF EXISTS idx_stock_dedup;
CREATE UNIQUE INDEX idx_stock_dedup
  ON price_stock (part_id, unit_price, quantity, new_or_used, seller_country,
                  completeness, fetched_at)
  NULLS NOT DISTINCT;
