-- F3.1 mekân: world şeması (K40). Kart QFK4EQTMAVFDTB1AKE91X2.
-- Konum pilotta enlem/boylam; PostGIS geography sütunu yakındaki şube sorgusu gerektiğinde (F4) şemaya tanımlı eklenir.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "world";

-- CreateTable
CREATE TABLE "world"."world_types" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config_schema" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "world_types_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "world"."worlds" (
    "id" UUID NOT NULL,
    "type_code" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "bounds" JSONB NOT NULL DEFAULT '{}',
    "cell_size_m" INTEGER NOT NULL DEFAULT 64,
    "default_spawn_place_id" UUID,
    "scene_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "worlds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "world"."regions" (
    "id" UUID NOT NULL,
    "world_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'district',
    "polygon" JSONB NOT NULL DEFAULT '[]',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "scene_id" UUID,

    CONSTRAINT "regions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "world"."parcels" (
    "id" UUID NOT NULL,
    "region_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "polygon" JSONB NOT NULL DEFAULT '[]',
    "capacity" TEXT NOT NULL DEFAULT 'M',
    "allowed_store_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'empty',

    CONSTRAINT "parcels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "world"."places" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "ref_type" TEXT,
    "ref_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "world"."place_geo" (
    "place_id" UUID NOT NULL,
    "lat" DECIMAL(9,6) NOT NULL,
    "lng" DECIMAL(9,6) NOT NULL,
    "address_line" TEXT,
    "province_code" TEXT,
    "district_code" TEXT,
    "country_code" CHAR(2) NOT NULL DEFAULT 'TR',
    "precision" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ(3),

    CONSTRAINT "place_geo_pkey" PRIMARY KEY ("place_id")
);

-- CreateTable
CREATE TABLE "world"."place_virtual" (
    "place_id" UUID NOT NULL,
    "world_id" UUID NOT NULL,
    "region_id" UUID,
    "parcel_id" UUID,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "z" DOUBLE PRECISION NOT NULL,
    "rot_y" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cell_x" INTEGER NOT NULL,
    "cell_z" INTEGER NOT NULL,

    CONSTRAINT "place_virtual_pkey" PRIMARY KEY ("place_id")
);

-- CreateTable
CREATE TABLE "world"."place_links" (
    "id" UUID NOT NULL,
    "from_place_id" UUID NOT NULL,
    "to_place_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "bidirectional" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "place_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "world"."admin_areas" (
    "code" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_code" TEXT,
    "lat" DECIMAL(9,6) NOT NULL,
    "lng" DECIMAL(9,6) NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "admin_areas_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "world"."transit_lines" (
    "id" UUID NOT NULL,
    "world_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'tram',
    "color" TEXT NOT NULL DEFAULT '#d97706',
    "path" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "transit_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "world"."transit_stations" (
    "id" UUID NOT NULL,
    "line_id" UUID NOT NULL,
    "place_id" UUID NOT NULL,
    "sort" INTEGER NOT NULL,
    "dwell_s" INTEGER NOT NULL DEFAULT 8,

    CONSTRAINT "transit_stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "world"."portals" (
    "id" UUID NOT NULL,
    "from_place_id" UUID NOT NULL,
    "to_world_id" UUID NOT NULL,
    "to_place_id" UUID,
    "kind" TEXT NOT NULL,
    "requires_load" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "portals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "world"."fast_travel_targets" (
    "id" UUID NOT NULL,
    "place_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "unlock_rule" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "fast_travel_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "worlds_slug_key" ON "world"."worlds"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "regions_world_id_slug_key" ON "world"."regions"("world_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "parcels_region_id_code_key" ON "world"."parcels"("region_id", "code");

-- CreateIndex
CREATE INDEX "places_ref_type_ref_id_idx" ON "world"."places"("ref_type", "ref_id");

-- CreateIndex
CREATE INDEX "places_kind_idx" ON "world"."places"("kind");

-- CreateIndex
CREATE INDEX "place_geo_province_code_district_code_idx" ON "world"."place_geo"("province_code", "district_code");

-- CreateIndex
CREATE INDEX "place_virtual_world_id_cell_x_cell_z_idx" ON "world"."place_virtual"("world_id", "cell_x", "cell_z");

-- CreateIndex
CREATE UNIQUE INDEX "place_links_from_place_id_to_place_id_kind_key" ON "world"."place_links"("from_place_id", "to_place_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "transit_lines_world_id_code_key" ON "world"."transit_lines"("world_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "transit_stations_line_id_sort_key" ON "world"."transit_stations"("line_id", "sort");

-- CreateIndex
CREATE UNIQUE INDEX "fast_travel_targets_place_id_key" ON "world"."fast_travel_targets"("place_id");

-- AddForeignKey
ALTER TABLE "world"."worlds" ADD CONSTRAINT "worlds_type_code_fkey" FOREIGN KEY ("type_code") REFERENCES "world"."world_types"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "world"."regions" ADD CONSTRAINT "regions_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "world"."worlds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "world"."parcels" ADD CONSTRAINT "parcels_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "world"."regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "world"."place_geo" ADD CONSTRAINT "place_geo_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "world"."places"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "world"."place_virtual" ADD CONSTRAINT "place_virtual_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "world"."places"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "world"."transit_lines" ADD CONSTRAINT "transit_lines_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "world"."worlds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "world"."transit_stations" ADD CONSTRAINT "transit_stations_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "world"."transit_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "world"."worlds" ADD CONSTRAINT "worlds_status_chk" CHECK ("status" IN ('draft', 'active', 'archived'));
ALTER TABLE "world"."regions" ADD CONSTRAINT "regions_kind_chk" CHECK ("kind" IN ('district', 'street', 'plaza', 'interior_floor'));
ALTER TABLE "world"."parcels"
  ADD CONSTRAINT "parcels_capacity_chk" CHECK ("capacity" IN ('S', 'M', 'L')),
  ADD CONSTRAINT "parcels_status_chk" CHECK ("status" IN ('empty', 'reserved', 'occupied'));
ALTER TABLE "world"."places" ADD CONSTRAINT "places_kind_chk"
  CHECK ("kind" IN ('store_entrance', 'branch', 'station', 'portal', 'showcase', 'landmark', 'spawn'));
ALTER TABLE "world"."place_geo"
  ADD CONSTRAINT "place_geo_lat_chk" CHECK ("lat" BETWEEN -90 AND 90),
  ADD CONSTRAINT "place_geo_lng_chk" CHECK ("lng" BETWEEN -180 AND 180),
  ADD CONSTRAINT "place_geo_precision_chk" CHECK ("precision" IN ('exact', 'street', 'district_center', 'province_center')),
  ADD CONSTRAINT "place_geo_source_chk" CHECK ("source" IN ('manual', 'admin_area_centroid', 'geocoder'));
ALTER TABLE "world"."admin_areas" ADD CONSTRAINT "admin_areas_level_chk" CHECK ("level" IN ('province', 'district'));
ALTER TABLE "world"."place_links" ADD CONSTRAINT "place_links_kind_chk" CHECK ("kind" IN ('map_to_world', 'branch_to_storefront', 'portal_pair'));

-- ---------------------------------------------------------------- Başlangıç verisi (K40, C1)
INSERT INTO "world"."world_types" ("code", "name") VALUES
  ('central_city', 'Merkezi alışveriş şehri'),
  ('turkey_map', 'Türkiye haritası'),
  ('local_world', 'Yerel dünya'),
  ('store_interior', 'Mağaza iç mekânı');

-- Pilot il/ilçe merkezleri (kullanıcı kararı 2026-11-06: 5 ilçe elle). Koordinatlar ilçe/il merkezi, yaklaşık.
-- Kod: plaka kodu; ilçe kodu plaka + ad. Tam il/ilçe listesi pilot sonrası açık veriyle (lisans kaydıyla) gelir.
INSERT INTO "world"."admin_areas" ("code", "level", "name", "parent_code", "lat", "lng", "source") VALUES
  ('05', 'province', 'Amasya', NULL, 40.649900, 35.835300, 'manual'),
  ('06', 'province', 'Ankara', NULL, 39.933400, 32.859700, 'manual'),
  ('34', 'province', 'İstanbul', NULL, 41.008200, 28.978400, 'manual'),
  ('37', 'province', 'Kastamonu', NULL, 41.388700, 33.782700, 'manual'),
  ('63', 'province', 'Şanlıurfa', NULL, 37.159100, 38.796900, 'manual'),
  ('05-merzifon', 'district', 'Merzifon', '05', 40.875300, 35.463300, 'manual'),
  ('06-akyurt', 'district', 'Akyurt', '06', 40.133300, 33.083300, 'manual'),
  ('34-atasehir', 'district', 'Ataşehir', '34', 40.992300, 29.124400, 'manual'),
  ('37-tosya', 'district', 'Tosya', '37', 41.016700, 34.033300, 'manual'),
  ('63-merkez', 'district', 'Merkez', '63', 37.159100, 38.796900, 'manual');

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'dtd_app') THEN
    GRANT USAGE ON SCHEMA "world" TO dtd_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "world" TO dtd_app;
  END IF;
END
$$;
