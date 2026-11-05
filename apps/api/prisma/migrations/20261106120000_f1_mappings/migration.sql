-- F1.3 eşleme: commerce.brands, catalog kategori ağacı, kategori ve marka eşlemeleri, türetilmiş ürün kategorileri.
-- Şemalar arası FK yok (K32): brand_id commerce.brands kimliğidir.

-- AlterTable
ALTER TABLE "catalog"."catalog_products" ADD COLUMN     "brand_id" UUID;

-- CreateTable
CREATE TABLE "catalog"."catalog_categories" (
    "id" UUID NOT NULL,
    "parent_id" UUID,
    "slug" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "catalog_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."catalog_categories_i18n" (
    "category_id" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "catalog_categories_i18n_pkey" PRIMARY KEY ("category_id","locale")
);

-- CreateTable
CREATE TABLE "catalog"."category_mappings" (
    "source_category_id" UUID NOT NULL,
    "catalog_category_id" UUID,
    "ignored" BOOLEAN NOT NULL DEFAULT false,
    "method" TEXT NOT NULL DEFAULT 'manual',
    "approved_by" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_mappings_pkey" PRIMARY KEY ("source_category_id")
);

-- CreateTable
CREATE TABLE "catalog"."product_categories" (
    "product_id" UUID NOT NULL,
    "catalog_category_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("product_id","catalog_category_id")
);

-- CreateTable
CREATE TABLE "catalog"."brand_mappings" (
    "id" UUID NOT NULL,
    "source_site_id" UUID NOT NULL,
    "source_key" TEXT NOT NULL,
    "source_name" TEXT NOT NULL,
    "brand_id" UUID,
    "ignored" BOOLEAN NOT NULL DEFAULT false,
    "method" TEXT NOT NULL DEFAULT 'manual',
    "approved_by" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."brands" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "owner_company_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "catalog_categories_slug_key" ON "catalog"."catalog_categories"("slug");

-- CreateIndex
CREATE INDEX "catalog_categories_parent_id_idx" ON "catalog"."catalog_categories"("parent_id");

-- CreateIndex
CREATE INDEX "category_mappings_catalog_category_id_idx" ON "catalog"."category_mappings"("catalog_category_id");

-- CreateIndex
CREATE INDEX "product_categories_catalog_category_id_idx" ON "catalog"."product_categories"("catalog_category_id");

-- CreateIndex
CREATE INDEX "brand_mappings_brand_id_idx" ON "catalog"."brand_mappings"("brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "brand_mappings_source_site_id_source_key_key" ON "catalog"."brand_mappings"("source_site_id", "source_key");

-- CreateIndex
CREATE UNIQUE INDEX "brands_slug_key" ON "commerce"."brands"("slug");

-- CreateIndex
CREATE INDEX "catalog_products_brand_id_idx" ON "catalog"."catalog_products"("brand_id");

-- AddForeignKey
ALTER TABLE "catalog"."catalog_categories" ADD CONSTRAINT "catalog_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "catalog"."catalog_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."catalog_categories_i18n" ADD CONSTRAINT "catalog_categories_i18n_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "catalog"."catalog_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."category_mappings" ADD CONSTRAINT "category_mappings_source_category_id_fkey" FOREIGN KEY ("source_category_id") REFERENCES "catalog"."source_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."category_mappings" ADD CONSTRAINT "category_mappings_catalog_category_id_fkey" FOREIGN KEY ("catalog_category_id") REFERENCES "catalog"."catalog_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."product_categories" ADD CONSTRAINT "product_categories_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."catalog_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."product_categories" ADD CONSTRAINT "product_categories_catalog_category_id_fkey" FOREIGN KEY ("catalog_category_id") REFERENCES "catalog"."catalog_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "catalog"."catalog_categories"
  ADD CONSTRAINT "catalog_categories_status_chk" CHECK ("status" IN ('active', 'archived')),
  ADD CONSTRAINT "catalog_categories_not_self_chk" CHECK ("parent_id" IS NULL OR "parent_id" <> "id");
ALTER TABLE "commerce"."brands"
  ADD CONSTRAINT "brands_status_chk" CHECK ("status" IN ('active', 'archived'));
-- Eşleme ya bir hedefe bağlıdır ya da bilerek yok sayılmıştır; ikisi birden olamaz
ALTER TABLE "catalog"."category_mappings"
  ADD CONSTRAINT "category_mappings_target_chk" CHECK (("catalog_category_id" IS NULL) = "ignored");
ALTER TABLE "catalog"."brand_mappings"
  ADD CONSTRAINT "brand_mappings_target_chk" CHECK (("brand_id" IS NULL) = "ignored");
-- Ürün başına en çok bir birincil kategori
CREATE UNIQUE INDEX "product_categories_primary_ux" ON "catalog"."product_categories" ("product_id") WHERE "is_primary";

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'dtd_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "commerce" TO dtd_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "catalog" TO dtd_app;
  END IF;
END
$$;
