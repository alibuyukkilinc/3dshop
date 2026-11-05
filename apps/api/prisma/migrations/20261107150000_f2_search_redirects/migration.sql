-- F2.4: analytics (yönlendirme K53, dönüşüm F5) ve arama dizinleri (K35). Kart 9HZAB56AVSW9XGAAVR7V.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "analytics";

-- CreateTable
CREATE TABLE "analytics"."redirects" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "source_site_id" UUID,
    "channel" TEXT NOT NULL,
    "target_url" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "redirects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics"."conversions" (
    "id" UUID NOT NULL,
    "redirect_id" UUID,
    "source_site_id" UUID NOT NULL,
    "external_order_id" TEXT NOT NULL,
    "amount_minor" BIGINT,
    "currency" CHAR(3),
    "matched_at" TIMESTAMPTZ(3),
    "received_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conversions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "redirects_product_id_created_at_idx" ON "analytics"."redirects"("product_id", "created_at");

-- CreateIndex
CREATE INDEX "redirects_store_id_created_at_idx" ON "analytics"."redirects"("store_id", "created_at");

-- CreateIndex
CREATE INDEX "conversions_redirect_id_idx" ON "analytics"."conversions"("redirect_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversions_source_site_id_external_order_id_key" ON "analytics"."conversions"("source_site_id", "external_order_id");

ALTER TABLE "analytics"."redirects"
  ADD CONSTRAINT "redirects_channel_chk" CHECK ("channel" IN ('2d', '3d', 'search', 'ai'));

-- ---------------------------------------------------------------- Arama (K35): Türkçe tam metin + trigram
-- pg_trgm güvenilir uzantıdır: veritabanı sahibi (dtd_owner) kurabilir. Staging'de zaten kurulu.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Ad + açıklama üzerinde Türkçe tam metin (kök bulma), ad üzerinde yazım hatasına dayanıklı trigram
CREATE INDEX IF NOT EXISTS "catalog_products_i18n_fts_idx" ON "catalog"."catalog_products_i18n"
  USING gin (to_tsvector('turkish', "name" || ' ' || "description_html"));
CREATE INDEX IF NOT EXISTS "catalog_products_i18n_name_trgm_idx" ON "catalog"."catalog_products_i18n"
  USING gin (lower("name") gin_trgm_ops);

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'dtd_app') THEN
    GRANT USAGE ON SCHEMA "analytics" TO dtd_app;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA "analytics" TO dtd_app;
  END IF;
END
$$;
