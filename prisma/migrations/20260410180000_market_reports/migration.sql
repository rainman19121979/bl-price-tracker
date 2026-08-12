CREATE TABLE "market_reports" (
  "id" SERIAL PRIMARY KEY,
  "user_id" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "trigger_reason" VARCHAR(50) NOT NULL,
  "report_md" TEXT NOT NULL,
  "metrics_json" TEXT NOT NULL
);
CREATE INDEX "idx_market_reports_user" ON "market_reports"("user_id", "created_at" DESC);
