-- Reparatur: die Init-Migration (20260325161121_init) hat für
-- user_watchlists nur die absoluten Basis-Spalten angelegt.
-- Über die Zeit wurden viele Spalten via schema.prisma erweitert
-- (jede via prisma db push auf der Dev-DB), aber es gab nie eine
-- offizielle Migration die die Änderungen mitträgt.
--
-- Frisch-Installs auf leerer DB verschluckten die fehlenden Spalten
-- deshalb — der App-Code liest z.B. new_or_used, my_price etc., aber
-- auf einer neu-migrierten DB existiert nichts davon.
--
-- Alle Statements sind ADD COLUMN IF NOT EXISTS → idempotent, sicher
-- auf existierenden Installs (dort sind die Spalten längst da).

ALTER TABLE "user_watchlists" ADD COLUMN IF NOT EXISTS "new_or_used" CHAR(1) NOT NULL DEFAULT 'U';
ALTER TABLE "user_watchlists" ADD COLUMN IF NOT EXISTS "bl_inventory_id" INTEGER;
ALTER TABLE "user_watchlists" ADD COLUMN IF NOT EXISTS "my_price" DECIMAL(10,4);
ALTER TABLE "user_watchlists" ADD COLUMN IF NOT EXISTS "my_quantity" INTEGER;
ALTER TABLE "user_watchlists" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "user_watchlists" ADD COLUMN IF NOT EXISTS "sale_rate" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "user_watchlists" ADD COLUMN IF NOT EXISTS "price_locked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "user_watchlists" ADD COLUMN IF NOT EXISTS "my_cost" DECIMAL(10,4);
ALTER TABLE "user_watchlists" ADD COLUMN IF NOT EXISTS "remarks" TEXT;
ALTER TABLE "user_watchlists" ADD COLUMN IF NOT EXISTS "prev_quantity" INTEGER;
ALTER TABLE "user_watchlists" ADD COLUMN IF NOT EXISTS "changed_at" TIMESTAMP(3);

-- Pricing-Cache (wird von lot-pricing.ts + Triggers gefüllt)
ALTER TABLE "user_watchlists" ADD COLUMN IF NOT EXISTS "suggested_price" DECIMAL(10,4);
ALTER TABLE "user_watchlists" ADD COLUMN IF NOT EXISTS "suggested_rule_name" VARCHAR(100);
ALTER TABLE "user_watchlists" ADD COLUMN IF NOT EXISTS "market_stock_median" DECIMAL(10,4);
ALTER TABLE "user_watchlists" ADD COLUMN IF NOT EXISTS "market_sold_median" DECIMAL(10,4);
ALTER TABLE "user_watchlists" ADD COLUMN IF NOT EXISTS "trend" VARCHAR(10);
ALTER TABLE "user_watchlists" ADD COLUMN IF NOT EXISTS "pricing_computed_at" TIMESTAMP(3);

-- Unique-Constraint auf (user_id, bl_inventory_id) — verhindert dass ein
-- BL-Lot doppelt im Watchlist landet. Wenn schon da, ignorieren.
CREATE UNIQUE INDEX IF NOT EXISTS "user_watchlists_user_id_bl_inventory_id_key"
  ON "user_watchlists" ("user_id", "bl_inventory_id");

-- Hilfs-Indizes für die typischen Queries
CREATE INDEX IF NOT EXISTS "user_watchlists_user_id_part_id_new_or_used_idx"
  ON "user_watchlists" ("user_id", "part_id", "new_or_used");
CREATE INDEX IF NOT EXISTS "idx_watchlist_changed"
  ON "user_watchlists" ("changed_at");
