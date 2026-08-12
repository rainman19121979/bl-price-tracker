-- AlterTable
ALTER TABLE "user_watchlists" ADD COLUMN     "my_price_new" DECIMAL(10,4),
ADD COLUMN     "my_price_used" DECIMAL(10,4),
ADD COLUMN     "my_quantity" INTEGER;
