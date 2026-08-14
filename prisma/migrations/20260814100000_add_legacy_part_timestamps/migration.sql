-- last_price_update + last_stock_update fehlten in der Init-Migration
-- (waren nur in der Original-Dev-DB vorhanden). Der Code liest sie an
-- mehreren Stellen (watchlist sort, refresh-route, crawler status).
-- Auf frischen Installs führte das zu "column does not exist".
-- IF NOT EXISTS: idempotent für existierende Installs.
ALTER TABLE "parts" ADD COLUMN IF NOT EXISTS "last_price_update" TIMESTAMP(3);
ALTER TABLE "parts" ADD COLUMN IF NOT EXISTS "last_stock_update" TIMESTAMP;

-- Indizes wie im Schema deklariert
CREATE INDEX IF NOT EXISTS "idx_parts_last_update" ON "parts" ("last_price_update");
CREATE INDEX IF NOT EXISTS "idx_parts_last_stock" ON "parts" ("last_stock_update");
