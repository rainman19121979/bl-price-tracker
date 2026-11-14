-- hb-tool als Quelle fuer Inventar + Bestellungen.
--
-- BrickSync ist abgeschaltet (11/2026), hb-tool ist Master fuer Bestand und
-- Bestellungen. Der Tracker holt beides per GET /api/tracker/{inventory,orders}
-- bei hb-tool ab, statt BL getInventory bzw. BSX-Ordner zu lesen.
-- Ist hbtool_url + Token gesetzt, ueberspringt der Scheduler BL-Auto-Sync und
-- BSX-Import fuer diesen User.

ALTER TABLE "users"
  ADD COLUMN "hbtool_url" VARCHAR(255),
  ADD COLUMN "hbtool_token_enc" BYTEA,
  ADD COLUMN "hbtool_orders_cursor" VARCHAR(30),
  ADD COLUMN "hbtool_inventory_etag" VARCHAR(100),
  ADD COLUMN "hbtool_last_inventory_at" TIMESTAMP(3),
  ADD COLUMN "hbtool_last_orders_at" TIMESTAMP(3),
  ADD COLUMN "hbtool_last_error" TEXT;
