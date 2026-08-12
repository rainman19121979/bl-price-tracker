ALTER TABLE "user_watchlists" ADD COLUMN "sale_rate" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "user_watchlists" ADD COLUMN "my_cost" DECIMAL(10,4);
ALTER TABLE "user_watchlists" ADD COLUMN "remarks" TEXT;
