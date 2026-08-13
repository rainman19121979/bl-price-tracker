-- Add BL-inventory metadata fields for BSX round-trip fidelity
ALTER TABLE "user_watchlists" ADD COLUMN IF NOT EXISTS "bulk" INT DEFAULT 1;
ALTER TABLE "user_watchlists" ADD COLUMN IF NOT EXISTS "bl_date_added" TIMESTAMPTZ;
