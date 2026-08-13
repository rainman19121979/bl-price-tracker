-- New sensible defaults: 6 months fresh window, 1000 calls/day BL limit.
-- Only changes the DEFAULT for new rows; existing users keep their current values.
ALTER TABLE "users" ALTER COLUMN "fresh_days" SET DEFAULT 180;
ALTER TABLE "user_api_keys" ALTER COLUMN "daily_limit" SET DEFAULT 1000;
