CREATE TABLE "bl_top_seller_imports" (
  "id" SERIAL PRIMARY KEY,
  "user_id" INTEGER NOT NULL,
  "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "item_type" VARCHAR(10) NOT NULL,
  "source" VARCHAR(50) NOT NULL DEFAULT 'manual_paste',
  "items_count" INTEGER NOT NULL,
  "matched_count" INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX "idx_topsellers_user" ON "bl_top_seller_imports" ("user_id", "imported_at" DESC);

CREATE TABLE "bl_top_seller_items" (
  "id" SERIAL PRIMARY KEY,
  "import_id" INTEGER NOT NULL REFERENCES "bl_top_seller_imports"("id") ON DELETE CASCADE,
  "rank" INTEGER NOT NULL,
  "part_no" VARCHAR(50) NOT NULL,
  "color_name" VARCHAR(100) NOT NULL,
  "part_name" VARCHAR(255) NOT NULL,
  "sold_90d" INTEGER NOT NULL,
  "sellers_count" INTEGER NOT NULL,
  "matched_part_id" INTEGER,
  "matched_color_id" INTEGER
);
CREATE INDEX "idx_topsellers_import" ON "bl_top_seller_items" ("import_id", "rank");
CREATE INDEX "idx_topsellers_part" ON "bl_top_seller_items" ("matched_part_id");
