-- F5.1 yerleşim motoru (A5, K23): yuvalar, kurallar, pinler, çalıştırmalar, sonuçlar, canlı yerleşim.

CREATE SCHEMA IF NOT EXISTS "placement";

CREATE TABLE "placement"."placement_slots" (
    "id" UUID NOT NULL,
    "scene_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "node_id" TEXT NOT NULL,
    "slot_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'showcase',
    "store_id" UUID,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "ordinal" INTEGER NOT NULL DEFAULT 0,
    "x" DOUBLE PRECISION NOT NULL,
    "z" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "placement_slots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "placement"."placement_rules" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "store_id" UUID,
    "category_id" UUID,
    "brand_id" UUID,
    "in_stock" BOOLEAN NOT NULL DEFAULT false,
    "sort_by" TEXT NOT NULL DEFAULT 'relevance',
    "limit_per_slot" INTEGER NOT NULL DEFAULT 1,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "valid_from" TIMESTAMPTZ(3),
    "valid_to" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "placement_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "placement"."placement_pins" (
    "id" UUID NOT NULL,
    "slot_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "item_type" TEXT NOT NULL DEFAULT 'product',
    "item_id" UUID NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT true,
    "valid_from" TIMESTAMPTZ(3),
    "valid_to" TIMESTAMPTZ(3),
    "reason" TEXT,
    "created_by" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "placement_pins_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "placement"."placement_runs" (
    "id" UUID NOT NULL,
    "trigger" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "stats" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    CONSTRAINT "placement_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "placement"."placement_results" (
    "run_id" UUID NOT NULL,
    "slot_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "item_type" TEXT NOT NULL,
    "item_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "rule_id" UUID,
    CONSTRAINT "placement_results_pkey" PRIMARY KEY ("run_id","slot_id","position")
);

CREATE TABLE "placement"."placement_live" (
    "slot_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "item_type" TEXT NOT NULL,
    "item_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "rule_id" UUID,
    "run_id" UUID NOT NULL,
    CONSTRAINT "placement_live_pkey" PRIMARY KEY ("slot_id","position")
);

CREATE UNIQUE INDEX "placement_slots_scene_id_slot_key_key" ON "placement"."placement_slots"("scene_id", "slot_key");
CREATE INDEX "placement_slots_store_id_idx" ON "placement"."placement_slots"("store_id");
CREATE INDEX "placement_pins_slot_id_status_idx" ON "placement"."placement_pins"("slot_id", "status");
CREATE INDEX "placement_runs_started_at_idx" ON "placement"."placement_runs"("started_at");

ALTER TABLE "placement"."placement_pins" ADD CONSTRAINT "placement_pins_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "placement"."placement_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "placement"."placement_slots"
  ADD CONSTRAINT "placement_slots_status_chk" CHECK ("status" IN ('active', 'orphaned')),
  ADD CONSTRAINT "placement_slots_kind_chk" CHECK ("kind" IN ('parcel', 'shelf', 'showcase', 'table', 'wall', 'kiosk')),
  ADD CONSTRAINT "placement_slots_capacity_chk" CHECK ("capacity" BETWEEN 1 AND 50);
ALTER TABLE "placement"."placement_rules"
  ADD CONSTRAINT "placement_rules_status_chk" CHECK ("status" IN ('active', 'archived')),
  ADD CONSTRAINT "placement_rules_sort_chk" CHECK ("sort_by" IN ('relevance', 'newest', 'price_asc', 'price_desc', 'name')),
  ADD CONSTRAINT "placement_rules_limit_chk" CHECK ("limit_per_slot" BETWEEN 1 AND 50);
ALTER TABLE "placement"."placement_pins"
  ADD CONSTRAINT "placement_pins_status_chk" CHECK ("status" IN ('active', 'removed')),
  ADD CONSTRAINT "placement_pins_item_type_chk" CHECK ("item_type" IN ('product'));
ALTER TABLE "placement"."placement_runs"
  ADD CONSTRAINT "placement_runs_status_chk" CHECK ("status" IN ('running', 'succeeded', 'failed')),
  ADD CONSTRAINT "placement_runs_trigger_chk" CHECK ("trigger" IN ('schedule', 'event', 'manual'));
ALTER TABLE "placement"."placement_results"
  ADD CONSTRAINT "placement_results_source_chk" CHECK ("source" IN ('pin', 'rule', 'default'));

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'dtd_app') THEN
    GRANT USAGE ON SCHEMA "placement" TO dtd_app;
    GRANT SELECT, INSERT, UPDATE ON "placement"."placement_slots", "placement"."placement_rules", "placement"."placement_pins", "placement"."placement_runs" TO dtd_app;
    GRANT SELECT, INSERT, DELETE ON "placement"."placement_results", "placement"."placement_live" TO dtd_app;
  END IF;
END
$$;
