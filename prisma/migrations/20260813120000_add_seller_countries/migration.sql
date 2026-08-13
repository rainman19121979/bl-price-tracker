-- Per-user seller-country filter for price-guide aggregations.
-- NULL = no filter (all countries counted). Default 'DE' for existing users
-- preserves their current behavior — they were previously getting only
-- DE-seller data because the BL API call was hardcoded to country_code=DE.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "seller_countries" TEXT DEFAULT 'DE';
