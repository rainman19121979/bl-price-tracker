-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "username" VARCHAR(100) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_api_keys" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "platform" VARCHAR(20) NOT NULL DEFAULT 'bricklink',
    "consumer_key" VARCHAR(255) NOT NULL,
    "consumer_secret_enc" BYTEA NOT NULL,
    "token_value" VARCHAR(255) NOT NULL,
    "token_secret_enc" BYTEA NOT NULL,
    "daily_limit" INTEGER NOT NULL DEFAULT 5000,
    "requests_today" INTEGER NOT NULL DEFAULT 0,
    "last_reset_date" DATE,
    "is_valid" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parts" (
    "id" SERIAL NOT NULL,
    "part_no" VARCHAR(50) NOT NULL,
    "color_id" INTEGER NOT NULL,
    "item_type" VARCHAR(10) NOT NULL DEFAULT 'PART',
    "part_name" VARCHAR(500),
    "color_name" VARCHAR(100),
    "category_id" INTEGER,
    "category_name" VARCHAR(200),
    "image_url" VARCHAR(500),
    "last_price_update" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_daily" (
    "id" BIGSERIAL NOT NULL,
    "part_id" INTEGER NOT NULL,
    "fetch_date" DATE NOT NULL,
    "new_or_used" CHAR(1) NOT NULL DEFAULT 'U',
    "seller_country" VARCHAR(2) NOT NULL DEFAULT 'DE',
    "currency_code" VARCHAR(3) NOT NULL DEFAULT 'EUR',
    "min_price" DECIMAL(10,4),
    "max_price" DECIMAL(10,4),
    "avg_price" DECIMAL(10,4),
    "qty_avg_price" DECIMAL(10,4),
    "unit_quantity" INTEGER,
    "total_quantity" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_sales" (
    "id" BIGSERIAL NOT NULL,
    "part_id" INTEGER NOT NULL,
    "date_ordered" TIMESTAMP(3) NOT NULL,
    "unit_price" DECIMAL(10,4) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "seller_country" VARCHAR(2) NOT NULL DEFAULT 'DE',
    "buyer_country" VARCHAR(2),
    "new_or_used" CHAR(1) NOT NULL DEFAULT 'U',
    "fetched_at" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_sales_pkey" PRIMARY KEY ("id","date_ordered")
);

-- CreateTable
CREATE TABLE "user_watchlists" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "part_id" INTEGER NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 5,
    "alert_below" DECIMAL(10,4),
    "alert_above" DECIMAL(10,4),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_watchlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crawl_queue" (
    "id" SERIAL NOT NULL,
    "part_id" INTEGER NOT NULL,
    "user_id" INTEGER,
    "new_or_used" CHAR(1) NOT NULL DEFAULT 'U',
    "priority" INTEGER NOT NULL DEFAULT 5,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "scheduled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "crawl_queue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "idx_parts_part_no" ON "parts"("part_no");

-- CreateIndex
CREATE INDEX "idx_parts_last_update" ON "parts"("last_price_update");

-- CreateIndex
CREATE UNIQUE INDEX "parts_part_no_color_id_item_type_key" ON "parts"("part_no", "color_id", "item_type");

-- CreateIndex
CREATE INDEX "idx_daily_part_date" ON "price_daily"("part_id", "fetch_date" DESC);

-- CreateIndex
CREATE INDEX "idx_daily_date" ON "price_daily"("fetch_date");

-- CreateIndex
CREATE UNIQUE INDEX "price_daily_part_id_fetch_date_new_or_used_seller_country_key" ON "price_daily"("part_id", "fetch_date", "new_or_used", "seller_country");

-- CreateIndex
CREATE INDEX "idx_sales_part_date" ON "price_sales"("part_id", "date_ordered" DESC);

-- CreateIndex
CREATE INDEX "idx_sales_buyer" ON "price_sales"("buyer_country", "date_ordered" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "user_watchlists_user_id_part_id_key" ON "user_watchlists"("user_id", "part_id");

-- CreateIndex
CREATE INDEX "idx_crawl_status" ON "crawl_queue"("status", "priority", "scheduled_at");

-- AddForeignKey
ALTER TABLE "user_api_keys" ADD CONSTRAINT "user_api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_daily" ADD CONSTRAINT "price_daily_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_sales" ADD CONSTRAINT "price_sales_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_watchlists" ADD CONSTRAINT "user_watchlists_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_watchlists" ADD CONSTRAINT "user_watchlists_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crawl_queue" ADD CONSTRAINT "crawl_queue_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crawl_queue" ADD CONSTRAINT "crawl_queue_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
