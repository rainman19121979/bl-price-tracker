DROP TABLE IF EXISTS wanted_list_items CASCADE;
DROP TABLE IF EXISTS wanted_lists CASCADE;
DROP TABLE IF EXISTS market_reports CASCADE;

ALTER TABLE partout_analyses
  DROP COLUMN IF EXISTS ai_report_md,
  DROP COLUMN IF EXISTS ai_generated_at;

ALTER TABLE users
  DROP COLUMN IF EXISTS ai_provider,
  DROP COLUMN IF EXISTS anthropic_api_key_enc;
