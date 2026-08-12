-- Recovery migration: two columns were live in the maintainer's dev DB but
-- never had a corresponding migration checked in. Fresh installs would crash
-- on the first query touching these fields. IF NOT EXISTS keeps this safe to
-- re-run.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "crawler_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "shipping_countries" TEXT;
