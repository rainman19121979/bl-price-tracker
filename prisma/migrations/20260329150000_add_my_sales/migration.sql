-- Add change tracking to user_watchlists
ALTER TABLE "user_watchlists" ADD COLUMN "prev_quantity" INTEGER;
ALTER TABLE "user_watchlists" ADD COLUMN "changed_at" TIMESTAMP(3);
CREATE INDEX "idx_watchlist_changed" ON "user_watchlists"("changed_at");

-- Create my_sales table
CREATE TABLE "my_sales" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "part_id" INTEGER NOT NULL,
    "new_or_used" CHAR(1) NOT NULL DEFAULT 'U',
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(10,4) NOT NULL,
    "sold_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "my_sales_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_my_sales_user_part" ON "my_sales"("user_id", "part_id", "sold_at" DESC);
ALTER TABLE "my_sales" ADD CONSTRAINT "my_sales_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "my_sales" ADD CONSTRAINT "my_sales_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
