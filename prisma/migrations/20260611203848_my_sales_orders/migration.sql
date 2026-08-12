-- Wipe legacy my_sales entries (created from inventory-sync quantity-delta detection,
-- not from real order data). Will be repopulated from BSX order files.
TRUNCATE TABLE "my_sales" RESTART IDENTITY;

ALTER TABLE "my_sales"
  ADD COLUMN "platform" VARCHAR(20),
  ADD COLUMN "order_id" VARCHAR(50),
  ADD COLUMN "customer" VARCHAR(150);

CREATE INDEX "idx_my_sales_order" ON "my_sales" ("user_id", "platform", "order_id");
CREATE UNIQUE INDEX "idx_my_sales_dedup"
  ON "my_sales" ("user_id", "platform", "order_id", "part_id", "new_or_used", "unit_price", "quantity");
