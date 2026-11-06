-- F3.3 sahne: sahneler, değişmez sürümler, düğüm dizini (K45). Kart QFKAB9T7H54H1E0YKBA072.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "scene";

-- CreateTable
CREATE TABLE "scene"."scenes" (
    "id" UUID NOT NULL,
    "owner_type" TEXT NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "live_version_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "scenes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scene"."scene_versions" (
    "id" UUID NOT NULL,
    "scene_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "schema_version" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "asset_version_ids" UUID[],
    "checksum" TEXT NOT NULL,
    "note" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scene_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scene"."scene_node_index" (
    "scene_version_id" UUID NOT NULL,
    "node_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ref_id" TEXT,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "z" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "scene_node_index_pkey" PRIMARY KEY ("scene_version_id","node_id","kind")
);

-- CreateIndex
CREATE UNIQUE INDEX "scenes_owner_type_owner_id_key" ON "scene"."scenes"("owner_type", "owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "scene_versions_scene_id_number_key" ON "scene"."scene_versions"("scene_id", "number");

-- CreateIndex
CREATE INDEX "scene_node_index_kind_ref_id_idx" ON "scene"."scene_node_index"("kind", "ref_id");

-- AddForeignKey
ALTER TABLE "scene"."scene_versions" ADD CONSTRAINT "scene_versions_scene_id_fkey" FOREIGN KEY ("scene_id") REFERENCES "scene"."scenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scene"."scene_node_index" ADD CONSTRAINT "scene_node_index_scene_version_id_fkey" FOREIGN KEY ("scene_version_id") REFERENCES "scene"."scene_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "scene"."scenes"
  ADD CONSTRAINT "scenes_owner_chk" CHECK ("owner_type" IN ('world', 'region', 'store_interior', 'map')),
  ADD CONSTRAINT "scenes_status_chk" CHECK ("status" IN ('active', 'archived'));

-- Sahne sürümü değişmez (K45): yeni içerik yeni sürümdür; geri alma eski sürüme işaretçidir
CREATE FUNCTION "scene"."forbid_version_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Sahne sürümü değiştirilemez ya da silinemez (K45)' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER "scene_versions_immutable" BEFORE UPDATE OR DELETE ON "scene"."scene_versions"
  FOR EACH ROW EXECUTE FUNCTION "scene"."forbid_version_change"();

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'dtd_app') THEN
    GRANT USAGE ON SCHEMA "scene" TO dtd_app;
    GRANT SELECT, INSERT, UPDATE ON "scene"."scenes" TO dtd_app;
    GRANT SELECT, INSERT ON "scene"."scene_versions", "scene"."scene_node_index" TO dtd_app;
  END IF;
END
$$;
