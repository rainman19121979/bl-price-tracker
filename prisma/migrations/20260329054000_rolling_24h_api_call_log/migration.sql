-- CreateTable: API call log for rolling 24h window
CREATE TABLE "api_call_log" (
    "id" BIGSERIAL NOT NULL,
    "api_key_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_call_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_api_call_log_key_time" ON "api_call_log"("api_key_id", "created_at" DESC);
CREATE INDEX "idx_api_call_log_time" ON "api_call_log"("created_at");

-- AddForeignKey
ALTER TABLE "api_call_log" ADD CONSTRAINT "api_call_log_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "user_api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Drop old columns (no longer needed with rolling window)
ALTER TABLE "user_api_keys" DROP COLUMN IF EXISTS "requests_today";
ALTER TABLE "user_api_keys" DROP COLUMN IF EXISTS "last_reset_date";
