-- price_stock wurde in der ursprünglichen Init-Migration (20260325161121_init)
-- vergessen und ist seither nur auf Dev-DBs vorhanden (dort per
-- `prisma db push` implizit angelegt worden). Frisch-Installs auf leerer DB
-- crashen deshalb bei der ersten Migration die price_stock referenziert
-- (20260814120000_set_completeness).
--
-- Diese Reparatur-Migration legt die Tabelle mit dem Schema-Stand VOR dem
-- completeness-Add-on an. Die completeness-Spalte wird in der folgenden
-- Migration hinzugefügt. Idempotent via IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "price_stock" (
  "id"             BIGSERIAL NOT NULL,
  "part_id"        INTEGER NOT NULL,
  "unit_price"     DECIMAL(10,4) NOT NULL,
  "quantity"       INTEGER NOT NULL,
  "seller_country" VARCHAR(2) NOT NULL DEFAULT 'DE',
  "new_or_used"    CHAR(1) NOT NULL DEFAULT 'U',
  "fetched_at"     DATE NOT NULL,
  "created_at"     TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "price_stock_pkey" PRIMARY KEY ("id", "fetched_at")
);

-- Foreign key nur anlegen wenn noch nicht da (auf existierenden DBs schon vorhanden)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'price_stock_part_id_fkey'
      AND table_name = 'price_stock'
  ) THEN
    ALTER TABLE "price_stock" ADD CONSTRAINT "price_stock_part_id_fkey"
      FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- Dedup-Unique-Index für Stock-Snapshots
CREATE UNIQUE INDEX IF NOT EXISTS "idx_stock_dedup"
  ON "price_stock" ("part_id", "unit_price", "quantity", "new_or_used", "fetched_at");

-- Standard-Indizes wie im Schema
CREATE INDEX IF NOT EXISTS "idx_stock_part_date"
  ON "price_stock" ("part_id", "fetched_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_stock_part_new_date"
  ON "price_stock" ("part_id", "new_or_used", "fetched_at" DESC);
