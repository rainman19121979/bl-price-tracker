-- In-app SMB configuration for the BSX orders source.
-- Type "local" (default) uses bsx_orders_dir; type "smb" uses the smb_* fields.
-- Password is AES-256-GCM encrypted like the BL API keys.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bsx_source_type" TEXT NOT NULL DEFAULT 'local';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bsx_smb_host" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bsx_smb_share" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bsx_smb_subpath" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bsx_smb_domain" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bsx_smb_user" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bsx_smb_password_enc" BYTEA;
