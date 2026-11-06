-- F3.2 3D varlık hattı: varlık, değişmez sürüm, içerik adresli dosyalar, lisans, işleme işleri (K27, K38, K46).
-- Kart QFK7NGRYHSRV356NWEQTQJ.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "assets";

-- CreateTable
CREATE TABLE "assets"."assets" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "owner_company_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "current_version_id" UUID,
    "license_exception_reason" TEXT,
    "license_exception_by" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets"."asset_versions" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "validation_report" JSONB NOT NULL DEFAULT '{}',
    "license_status" TEXT NOT NULL DEFAULT 'unknown',
    "triangle_count" INTEGER,
    "bounds" JSONB,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets"."asset_files" (
    "id" UUID NOT NULL,
    "asset_version_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "mime" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,

    CONSTRAINT "asset_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets"."asset_licenses" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "license_type" TEXT NOT NULL,
    "source_url" TEXT,
    "attribution" TEXT,
    "verified_by" TEXT,
    "verified_at" TIMESTAMPTZ(3),
    "valid_to" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets"."asset_processing_jobs" (
    "id" UUID NOT NULL,
    "asset_version_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_processing_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assets_kind_status_idx" ON "assets"."assets"("kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "asset_versions_asset_id_number_key" ON "assets"."asset_versions"("asset_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "asset_files_asset_version_id_role_key" ON "assets"."asset_files"("asset_version_id", "role");

-- CreateIndex
CREATE INDEX "asset_licenses_asset_id_idx" ON "assets"."asset_licenses"("asset_id");

-- CreateIndex
CREATE INDEX "asset_processing_jobs_status_created_at_idx" ON "assets"."asset_processing_jobs"("status", "created_at");

-- AddForeignKey
ALTER TABLE "assets"."asset_versions" ADD CONSTRAINT "asset_versions_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"."assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets"."asset_files" ADD CONSTRAINT "asset_files_asset_version_id_fkey" FOREIGN KEY ("asset_version_id") REFERENCES "assets"."asset_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets"."asset_licenses" ADD CONSTRAINT "asset_licenses_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"."assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets"."asset_processing_jobs" ADD CONSTRAINT "asset_processing_jobs_asset_version_id_fkey" FOREIGN KEY ("asset_version_id") REFERENCES "assets"."asset_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "assets"."assets"
  ADD CONSTRAINT "assets_kind_chk" CHECK ("kind" IN ('building', 'prop', 'furniture', 'product_model', 'texture', 'environment')),
  ADD CONSTRAINT "assets_status_chk" CHECK ("status" IN ('uploaded', 'processing', 'ready', 'rejected', 'archived'));
ALTER TABLE "assets"."asset_versions"
  ADD CONSTRAINT "asset_versions_status_chk" CHECK ("status" IN ('uploaded', 'processing', 'ready', 'rejected')),
  ADD CONSTRAINT "asset_versions_license_chk" CHECK ("license_status" IN ('unknown', 'verified', 'rejected'));
ALTER TABLE "assets"."asset_files"
  ADD CONSTRAINT "asset_files_role_chk" CHECK ("role" IN ('source', 'lod0', 'lod1', 'lod2', 'preview'));
ALTER TABLE "assets"."asset_licenses"
  ADD CONSTRAINT "asset_licenses_type_chk" CHECK ("license_type" IN ('owned', 'cc0', 'cc_by', 'commercial', 'custom'));
ALTER TABLE "assets"."asset_processing_jobs"
  ADD CONSTRAINT "asset_jobs_status_chk" CHECK ("status" IN ('pending', 'running', 'succeeded', 'failed'));

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'dtd_app') THEN
    GRANT USAGE ON SCHEMA "assets" TO dtd_app;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA "assets" TO dtd_app;
  END IF;
END
$$;
