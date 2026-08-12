ALTER TABLE "user_watchlists"
  ADD COLUMN "suggested_price"      DECIMAL(10,4),
  ADD COLUMN "suggested_rule_name"  VARCHAR(100),
  ADD COLUMN "market_stock_median"  DECIMAL(10,4),
  ADD COLUMN "market_sold_median"   DECIMAL(10,4),
  ADD COLUMN "trend"                VARCHAR(10),
  ADD COLUMN "pricing_computed_at"  TIMESTAMP(3);

CREATE INDEX "idx_watchlist_suggested" ON "user_watchlists" ("user_id", "suggested_price");
