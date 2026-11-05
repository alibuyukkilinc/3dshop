-- F2.1 kural motoru: rules şeması, kısıtlar, temel kurallar. Cortex K43, kart V98T6R4HCQHH4V3MWXQ43.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "rules";

-- CreateTable
CREATE TABLE "rules"."rules" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "layer" TEXT NOT NULL,
    "effect" TEXT NOT NULL,
    "effect_params" JSONB NOT NULL DEFAULT '{}',
    "condition" JSONB,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "overrides_rule_id" UUID,
    "legal_ref" TEXT,
    "reason" TEXT,
    "valid_from" TIMESTAMPTZ(3),
    "valid_to" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL DEFAULT 'draft',
    "system" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rules"."rule_targets" (
    "id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID,
    "include" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "rule_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rules"."rule_channels" (
    "rule_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,

    CONSTRAINT "rule_channels_pkey" PRIMARY KEY ("rule_id","channel")
);

-- CreateTable
CREATE TABLE "rules"."visibility_resolved" (
    "target_type" TEXT NOT NULL,
    "target_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "visible" BOOLEAN NOT NULL,
    "boost" DECIMAL(8,3) NOT NULL DEFAULT 1,
    "layer" TEXT,
    "decided_by_rule_id" UUID,
    "explanation" JSONB NOT NULL,
    "ruleset_version" INTEGER NOT NULL,
    "computed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "visibility_resolved_pkey" PRIMARY KEY ("target_type","target_id","channel")
);

-- CreateTable
CREATE TABLE "rules"."ruleset_versions" (
    "number" INTEGER NOT NULL,
    "changeset_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ruleset_versions_pkey" PRIMARY KEY ("number")
);

-- CreateIndex
CREATE UNIQUE INDEX "rules_code_key" ON "rules"."rules"("code");

-- CreateIndex
CREATE INDEX "rules_status_layer_idx" ON "rules"."rules"("status", "layer");

-- CreateIndex
CREATE INDEX "rule_targets_rule_id_idx" ON "rules"."rule_targets"("rule_id");

-- CreateIndex
CREATE INDEX "visibility_resolved_channel_target_type_visible_idx" ON "rules"."visibility_resolved"("channel", "target_type", "visible");

-- AddForeignKey
ALTER TABLE "rules"."rule_targets" ADD CONSTRAINT "rule_targets_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "rules"."rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules"."rule_channels" ADD CONSTRAINT "rule_channels_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "rules"."rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------- Kısıtlar (K43, K8)
ALTER TABLE "rules"."rules"
  ADD CONSTRAINT "rules_layer_chk" CHECK ("layer" IN ('mandatory_block', 'exception', 'normal', 'default')),
  ADD CONSTRAINT "rules_effect_chk" CHECK ("effect" IN ('allow', 'deny', 'boost', 'demote')),
  ADD CONSTRAINT "rules_status_chk" CHECK ("status" IN ('draft', 'active', 'archived')),
  -- Hukuki/KVKK engeli yalnız gizler ve dayanağı (dilekçe, karar, KVKK talep no) yazılı olmalı
  ADD CONSTRAINT "rules_legal_chk" CHECK ("layer" <> 'mandatory_block' OR ("effect" = 'deny' AND "legal_ref" IS NOT NULL AND length(btrim("legal_ref")) > 0)),
  ADD CONSTRAINT "rules_overrides_only_exception_chk" CHECK ("overrides_rule_id" IS NULL OR "layer" = 'exception');
ALTER TABLE "rules"."rule_targets"
  ADD CONSTRAINT "rule_targets_type_chk" CHECK ("target_type" IN ('world', 'region', 'company', 'brand', 'store', 'category', 'product', 'variant', 'asset', 'place'));
ALTER TABLE "rules"."rule_channels"
  ADD CONSTRAINT "rule_channels_chk" CHECK ("channel" IN ('3d', '2d', 'search', 'ai', 'seo', 'ads', 'campaign'));

-- İstisna hukuki engeli ezemez (değerlendirici zaten katman sırasıyla korur; bu ikinci kilit)
CREATE FUNCTION "rules"."forbid_override_of_legal_block"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.overrides_rule_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM rules.rules WHERE id = NEW.overrides_rule_id AND layer = 'mandatory_block'
  ) THEN
    RAISE EXCEPTION 'Hukuki/KVKK engeli istisnayla ezilemez (K43)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "rules_forbid_override_of_legal_block"
  BEFORE INSERT OR UPDATE OF "overrides_rule_id" ON "rules"."rules"
  FOR EACH ROW EXECUTE FUNCTION "rules"."forbid_override_of_legal_block"();

-- Hukuki engel arşivlenemez ve silinemez; kaldırılması yalnız yeni bir karar/dayanakla yeni kural sürümüdür
CREATE FUNCTION "rules"."protect_legal_block"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.layer = 'mandatory_block' AND OLD.status = 'active' THEN
    RAISE EXCEPTION 'Aktif hukuki engel silinemez (K43)' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.layer = 'mandatory_block' AND OLD.status = 'active' AND NEW.layer <> 'mandatory_block' THEN
    RAISE EXCEPTION 'Hukuki engelin katmanı değiştirilemez (K43)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER "rules_protect_legal_block"
  BEFORE UPDATE OR DELETE ON "rules"."rules"
  FOR EACH ROW EXECUTE FUNCTION "rules"."protect_legal_block"();

-- ---------------------------------------------------------------- Temel kurallar (kural-motoru: katmanlar)
INSERT INTO "rules"."ruleset_versions" ("number", "note") VALUES (1, 'F2.1 temel kurallar');

INSERT INTO "rules"."rules" ("id", "code", "name", "layer", "effect", "condition", "priority", "reason", "status", "system") VALUES
  ('01960000-0000-7000-8000-000000000001', 'SYS_DEFAULT_VISIBLE', 'Varsayılan: her kanalda görünür', 'default', 'allow', NULL, 0,
   'Kanal varsayılanı: ayrıca kural yoksa görünür.', 'active', true),
  ('01960000-0000-7000-8000-000000000002', 'SYS_SOURCE_INACTIVE', 'Kaynakta pasif ya da kaldırılmış ürün gizli', 'normal', 'deny',
   '{"fact": "product.source_status", "op": "ne", "value": "active"}', 0,
   'Kaynak site doğrudur (K06): sitede satılmayan ürün platformda da gösterilmez. İstisnayla "satışta değil" olarak tutulabilir.', 'active', true),
  ('01960000-0000-7000-8000-000000000003', 'SYS_STORE_NOT_PUBLISHED', 'Yayında olmayan mağaza ve ürünleri gizli', 'normal', 'deny',
   '{"fact": "store.status", "op": "ne", "value": "active"}', 0,
   'Mağaza yayınla açılır (K44); taslak ya da arşiv mağaza hiçbir kanalda görünmez.', 'active', true),
  ('01960000-0000-7000-8000-000000000004', 'SYS_OUT_OF_STOCK_3D', 'Stokta olmayan ürün 3D vitrine konmaz', 'normal', 'deny',
   '{"fact": "product.stock", "op": "lte", "value": 0}', 0,
   'Vitrin/raf yuvası stokta olanlarla dolar; 2D ve aramada "stokta yok" olarak görünür.', 'active', true);

INSERT INTO "rules"."rule_targets" ("id", "rule_id", "target_type", "target_id", "include") VALUES
  ('01960000-0000-7000-8000-000000000102', '01960000-0000-7000-8000-000000000002', 'product', NULL, true),
  ('01960000-0000-7000-8000-000000000104', '01960000-0000-7000-8000-000000000004', 'product', NULL, true);

INSERT INTO "rules"."rule_channels" ("rule_id", "channel") VALUES
  ('01960000-0000-7000-8000-000000000004', '3d');

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'dtd_app') THEN
    GRANT USAGE ON SCHEMA "rules" TO dtd_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "rules" TO dtd_app;
  END IF;
END
$$;
