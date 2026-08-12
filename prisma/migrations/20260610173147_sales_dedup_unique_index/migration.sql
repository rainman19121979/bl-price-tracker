-- Remove duplicate sales rows (BL returns 6 months of sales on every crawl;
-- without a unique constraint, ON CONFLICT DO NOTHING in the crawler INSERTs
-- did not actually deduplicate, causing massive duplication of sales data).
WITH dups AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY part_id, date_ordered, unit_price, quantity, buyer_country, new_or_used, seller_country
    ORDER BY id
  ) AS rn
  FROM price_sales
)
DELETE FROM price_sales s
USING dups
WHERE s.id = dups.id AND dups.rn > 1;

-- Enforce dedup going forward: now ON CONFLICT DO NOTHING in crawler/refresh works correctly.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_dedup
  ON price_sales (part_id, date_ordered, unit_price, quantity, buyer_country, new_or_used, seller_country);
