CREATE TABLE "wanted_lists" (
  "id" SERIAL PRIMARY KEY,
  "user_id" INTEGER NOT NULL,
  "name" VARCHAR(150) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "budget" DECIMAL(10, 2),
  "estimated_cost" DECIMAL(10, 2),
  "estimated_revenue" DECIMAL(10, 2),
  "ai_report_md" TEXT
);
CREATE INDEX "idx_wanted_user" ON "wanted_lists"("user_id", "created_at" DESC);

CREATE TABLE "wanted_list_items" (
  "id" SERIAL PRIMARY KEY,
  "list_id" INTEGER NOT NULL REFERENCES "wanted_lists"("id") ON DELETE CASCADE,
  "part_id" INTEGER,
  "part_no" VARCHAR(50) NOT NULL,
  "color_id" INTEGER NOT NULL,
  "item_type" VARCHAR(10) NOT NULL,
  "condition" CHAR(1) NOT NULL,
  "wanted_qty" INTEGER NOT NULL,
  "max_price" DECIMAL(10, 4) NOT NULL,
  "reason" VARCHAR(500),
  "source" VARCHAR(20) NOT NULL DEFAULT 'ai',
  "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "idx_wanted_list" ON "wanted_list_items"("list_id");
