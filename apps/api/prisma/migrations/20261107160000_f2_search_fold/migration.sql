-- F2.4 arama düzeltmesi: veritabanı yerel ayarından bağımsız Türkçe katlama (K35).
-- lower() C/POSIX yerel ayarında Türkçe büyük harfleri (Ü, Ş, İ…) küçültmez ve Snowball Türkçe kökü tutarsız
-- ("açıklama" → "açıkla", "açıklamalar" → "açıklama"). Ad ve açıklama sabit bir tabloyla ASCII'ye katlanır;
-- arama terim başı eşleşmesi + trigram ile yapılır. Aynı kural uygulamada (foldTr) sorguya uygulanır.

CREATE OR REPLACE FUNCTION catalog.fold_tr(t text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $$
  SELECT lower(translate(
    regexp_replace(t, '<[^>]*>', ' ', 'g'),
    'ÇĞİIÖŞÜçğıöşüÂâÎîÛû',
    'cgiiosucgiosuaaiiuu'
  ))
$$;

DROP INDEX IF EXISTS "catalog"."catalog_products_i18n_fts_idx";
DROP INDEX IF EXISTS "catalog"."catalog_products_i18n_name_trgm_idx";

CREATE INDEX "catalog_products_i18n_fold_fts_idx" ON "catalog"."catalog_products_i18n"
  USING gin (to_tsvector('simple', catalog.fold_tr("name" || ' ' || "description_html")));
CREATE INDEX "catalog_products_i18n_fold_name_trgm_idx" ON "catalog"."catalog_products_i18n"
  USING gin (catalog.fold_tr("name") gin_trgm_ops);

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'dtd_app') THEN
    GRANT EXECUTE ON FUNCTION catalog.fold_tr(text) TO dtd_app;
  END IF;
END
$$;
