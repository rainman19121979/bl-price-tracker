ALTER TABLE users
  ADD COLUMN bsx_orders_dir TEXT,
  ADD COLUMN ai_provider VARCHAR(20) NOT NULL DEFAULT 'none',
  ADD COLUMN anthropic_api_key_enc BYTEA;
