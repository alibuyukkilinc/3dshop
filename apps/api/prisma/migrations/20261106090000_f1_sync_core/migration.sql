-- F1.1 çekirdek eşitleme: commerce, integration, catalog şemaları. Cortex: K32, K33, K41, K42; kart PR86EV424Y2M0V5K8QWA1Z.
-- Şemalar arası yabancı anahtar yok (K32). Alış fiyatı hiçbir tabloda yok (K41).

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "catalog";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "commerce";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "integration";

-- CreateTable
CREATE TABLE "catalog"."catalog_products" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "source_site_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "brand_source_name" TEXT,
    "sku" TEXT,
    "barcode" TEXT,
    "mpn" TEXT,
    "model_code" TEXT,
    "status" TEXT NOT NULL,
    "physical" JSONB,
    "source_url" TEXT,
    "source_updated_at" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "synced_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "catalog_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."catalog_products_i18n" (
    "product_id" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description_html" TEXT NOT NULL,

    CONSTRAINT "catalog_products_i18n_pkey" PRIMARY KEY ("product_id","locale")
);

-- CreateTable
CREATE TABLE "catalog"."catalog_variants" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "external_ref" TEXT NOT NULL,
    "option_values" JSONB NOT NULL,
    "sku" TEXT,
    "stock_quantity" INTEGER NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "catalog_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."catalog_prices" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_ref" TEXT,
    "price_final_minor" BIGINT NOT NULL,
    "price_list_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "tax_included" BOOLEAN NOT NULL,
    "valid_until" TIMESTAMPTZ(3),
    "received_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "catalog_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."catalog_stock" (
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "catalog_stock_pkey" PRIMARY KEY ("product_id")
);

-- CreateTable
CREATE TABLE "catalog"."catalog_media" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "asset_id" UUID,
    "sort" INTEGER NOT NULL,

    CONSTRAINT "catalog_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."source_categories" (
    "id" UUID NOT NULL,
    "source_site_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "source_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."product_source_categories" (
    "product_id" UUID NOT NULL,
    "source_category_id" UUID NOT NULL,

    CONSTRAINT "product_source_categories_pkey" PRIMARY KEY ("product_id","source_category_id")
);

-- CreateTable
CREATE TABLE "commerce"."companies" (
    "id" UUID NOT NULL,
    "legal_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "tax_number" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'retailer',
    "status" TEXT NOT NULL DEFAULT 'active',
    "website" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."stores" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "store_type" TEXT NOT NULL DEFAULT 'multi_brand',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."store_sources" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "source_site_id" UUID NOT NULL,
    "filter" JSONB NOT NULL DEFAULT '{}',
    "is_primary" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "store_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration"."source_systems" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "adapter" TEXT NOT NULL,
    "contract_version" TEXT NOT NULL,
    "capabilities" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "source_systems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration"."source_sites" (
    "id" UUID NOT NULL,
    "source_system_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "store_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "credentials_enc" TEXT,
    "watermark" TEXT,
    "last_full_sync_at" TIMESTAMPTZ(3),
    "last_delta_sync_at" TIMESTAMPTZ(3),
    "last_webhook_at" TIMESTAMPTZ(3),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "circuit_open_until" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "source_sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration"."source_records" (
    "id" UUID NOT NULL,
    "source_site_id" UUID NOT NULL,
    "entity" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "source_updated_at" TEXT NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at_source" TIMESTAMPTZ(3),

    CONSTRAINT "source_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration"."sync_runs" (
    "id" UUID NOT NULL,
    "source_site_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3),
    "stats" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "catalog_products_store_id_status_idx" ON "catalog"."catalog_products"("store_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_products_source_site_id_external_id_key" ON "catalog"."catalog_products"("source_site_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_variants_product_id_external_ref_key" ON "catalog"."catalog_variants"("product_id", "external_ref");

-- CreateIndex
CREATE INDEX "catalog_prices_product_id_idx" ON "catalog"."catalog_prices"("product_id");

-- CreateIndex
CREATE INDEX "catalog_prices_valid_until_idx" ON "catalog"."catalog_prices"("valid_until");

-- CreateIndex
CREATE INDEX "catalog_media_product_id_idx" ON "catalog"."catalog_media"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_categories_source_site_id_external_id_key" ON "catalog"."source_categories"("source_site_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "stores_slug_key" ON "commerce"."stores"("slug");

-- CreateIndex
CREATE INDEX "stores_company_id_idx" ON "commerce"."stores"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "store_sources_source_site_id_key" ON "commerce"."store_sources"("source_site_id");

-- CreateIndex
CREATE INDEX "store_sources_store_id_idx" ON "commerce"."store_sources"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_systems_code_key" ON "integration"."source_systems"("code");

-- CreateIndex
CREATE UNIQUE INDEX "source_sites_code_key" ON "integration"."source_sites"("code");

-- CreateIndex
CREATE UNIQUE INDEX "source_records_source_site_id_entity_external_id_key" ON "integration"."source_records"("source_site_id", "entity", "external_id");

-- CreateIndex
CREATE INDEX "sync_runs_source_site_id_started_at_idx" ON "integration"."sync_runs"("source_site_id", "started_at" DESC);

-- AddForeignKey
ALTER TABLE "catalog"."catalog_products_i18n" ADD CONSTRAINT "catalog_products_i18n_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."catalog_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."catalog_variants" ADD CONSTRAINT "catalog_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."catalog_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."catalog_prices" ADD CONSTRAINT "catalog_prices_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."catalog_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."catalog_stock" ADD CONSTRAINT "catalog_stock_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."catalog_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."catalog_media" ADD CONSTRAINT "catalog_media_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."catalog_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."product_source_categories" ADD CONSTRAINT "product_source_categories_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."catalog_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."product_source_categories" ADD CONSTRAINT "product_source_categories_source_category_id_fkey" FOREIGN KEY ("source_category_id") REFERENCES "catalog"."source_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "commerce"."companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."store_sources" ADD CONSTRAINT "store_sources_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration"."source_sites" ADD CONSTRAINT "source_sites_source_system_id_fkey" FOREIGN KEY ("source_system_id") REFERENCES "integration"."source_systems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration"."source_records" ADD CONSTRAINT "source_records_source_site_id_fkey" FOREIGN KEY ("source_site_id") REFERENCES "integration"."source_sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration"."sync_runs" ADD CONSTRAINT "sync_runs_source_site_id_fkey" FOREIGN KEY ("source_site_id") REFERENCES "integration"."source_sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Ürün başına tek fiyat satırı; varyant fiyatı varyant ref'i başına tek (K41: yalnız son fiyat)
CREATE UNIQUE INDEX "catalog_prices_product_variant_ux"
  ON "catalog"."catalog_prices" ("product_id", COALESCE("variant_ref", ''));

ALTER TABLE "catalog"."catalog_products"
  ADD CONSTRAINT "catalog_products_status_chk" CHECK ("status" IN ('active', 'inactive', 'removed_at_source'));
ALTER TABLE "catalog"."catalog_prices"
  ADD CONSTRAINT "catalog_prices_nonneg_chk" CHECK ("price_final_minor" >= 0 AND "price_list_minor" >= "price_final_minor");
ALTER TABLE "catalog"."catalog_stock"
  ADD CONSTRAINT "catalog_stock_status_chk" CHECK ("status" IN ('in_stock', 'out_of_stock'));
ALTER TABLE "commerce"."stores"
  ADD CONSTRAINT "stores_status_chk" CHECK ("status" IN ('draft', 'active', 'archived'));
ALTER TABLE "integration"."source_sites"
  ADD CONSTRAINT "source_sites_status_chk" CHECK ("status" IN ('active', 'paused'));
ALTER TABLE "integration"."sync_runs"
  ADD CONSTRAINT "sync_runs_kind_chk" CHECK ("kind" IN ('full', 'delta')),
  ADD CONSTRAINT "sync_runs_status_chk" CHECK ("status" IN ('running', 'succeeded', 'failed'));

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'dtd_app') THEN
    GRANT USAGE ON SCHEMA "commerce", "integration", "catalog" TO dtd_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "commerce" TO dtd_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "integration" TO dtd_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "catalog" TO dtd_app;
  END IF;
END
$$;
