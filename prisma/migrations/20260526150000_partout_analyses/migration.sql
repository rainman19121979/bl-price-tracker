CREATE TABLE "partout_analyses" (
  "id" SERIAL PRIMARY KEY,
  "user_id" INTEGER NOT NULL,
  "set_no" VARCHAR(50) NOT NULL,
  "set_name" VARCHAR(255),
  "condition" CHAR(1) NOT NULL,
  "set_cost" DECIMAL(10, 2),
  "part_out_formula" DECIMAL(10, 2),
  "margin_pct" DECIMAL(6, 2),
  "result_json" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "idx_partout_user" ON "partout_analyses"("user_id", "created_at" DESC);
