-- Mağaza logosu ve ikonu (3D mağaza deneyimi): kaynak sitenin CDN adresleri, yalnız https
ALTER TABLE "commerce"."stores" ADD COLUMN "logo_url" TEXT, ADD COLUMN "icon_url" TEXT;
ALTER TABLE "commerce"."stores"
  ADD CONSTRAINT "stores_logo_url_https_chk" CHECK ("logo_url" IS NULL OR "logo_url" ~ '^https://'),
  ADD CONSTRAINT "stores_icon_url_https_chk" CHECK ("icon_url" IS NULL OR "icon_url" ~ '^https://');
