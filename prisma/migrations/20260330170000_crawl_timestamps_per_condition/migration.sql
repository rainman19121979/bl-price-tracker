-- Add per-condition crawl timestamps
ALTER TABLE "parts" ADD COLUMN "last_sold_crawl_n" TIMESTAMP(3);
ALTER TABLE "parts" ADD COLUMN "last_sold_crawl_u" TIMESTAMP(3);
ALTER TABLE "parts" ADD COLUMN "last_stock_crawl_n" TIMESTAMP(3);
ALTER TABLE "parts" ADD COLUMN "last_stock_crawl_u" TIMESTAMP(3);

-- Copy existing timestamps as initial values (only if the legacy columns exist —
-- fresh installs never had `last_stock_update` and the parts table is empty
-- anyway, so this block is a no-op for them).
DO $$
DECLARE
  has_last_price   boolean;
  has_last_stock   boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'parts' AND column_name = 'last_price_update'
  ) INTO has_last_price;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'parts' AND column_name = 'last_stock_update'
  ) INTO has_last_stock;

  IF has_last_price AND has_last_stock THEN
    UPDATE "parts" SET
      last_sold_crawl_n  = last_price_update,
      last_sold_crawl_u  = last_price_update,
      last_stock_crawl_n = last_stock_update,
      last_stock_crawl_u = last_stock_update
    WHERE last_price_update IS NOT NULL OR last_stock_update IS NOT NULL;

    UPDATE "parts" SET last_sold_crawl_u = NULL
    WHERE id IN (
      SELECT p.id FROM parts p
      WHERE p.last_sold_crawl_u IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM price_sales s WHERE s.part_id = p.id AND s.new_or_used = 'U')
    );

    UPDATE "parts" SET last_sold_crawl_n = NULL
    WHERE id IN (
      SELECT p.id FROM parts p
      WHERE p.last_sold_crawl_n IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM price_sales s WHERE s.part_id = p.id AND s.new_or_used = 'N')
    );

    UPDATE "parts" SET last_stock_crawl_u = NULL
    WHERE id IN (
      SELECT p.id FROM parts p
      WHERE p.last_stock_crawl_u IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM price_stock s WHERE s.part_id = p.id AND s.new_or_used = 'U')
    );

    UPDATE "parts" SET last_stock_crawl_n = NULL
    WHERE id IN (
      SELECT p.id FROM parts p
      WHERE p.last_stock_crawl_n IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM price_stock s WHERE s.part_id = p.id AND s.new_or_used = 'N')
    );
  END IF;
END $$;
