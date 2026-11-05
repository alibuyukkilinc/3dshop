-- F0 temel: platform, audit, identity şemaları. Cortex: K32, K33, K34, K47; görev F0.2.
-- Prisma tarafından üretilen kısım (+ audit_log bölümleme):

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "audit";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "identity";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "platform";

-- CreateTable
CREATE TABLE "audit"."audit_log" (
    "id" UUID NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "seq" BIGINT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "changeset_id" UUID,
    "diff" JSONB,
    "reason" TEXT,
    "request_id" TEXT,
    "ip_hash" TEXT,
    "prev_hash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id","at")
) PARTITION BY RANGE ("at");

-- CreateTable
CREATE TABLE "identity"."admin_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "totp_secret_enc" TEXT,
    "totp_pending_secret_enc" TEXT,
    "totp_enabled_at" TIMESTAMPTZ(3),
    "totp_last_step" BIGINT,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."roles" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "identity"."admin_user_roles" (
    "admin_user_id" UUID NOT NULL,
    "role_code" TEXT NOT NULL,

    CONSTRAINT "admin_user_roles_pkey" PRIMARY KEY ("admin_user_id","role_code")
);

-- CreateTable
CREATE TABLE "identity"."admin_sessions" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "admin_user_id" UUID NOT NULL,
    "stage" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_hash" TEXT,
    "user_agent" TEXT,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."admin_recovery_codes" (
    "id" UUID NOT NULL,
    "admin_user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."outbox" (
    "id" UUID NOT NULL,
    "module" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "published_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "dead" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."inbox" (
    "consumer" TEXT NOT NULL,
    "event_id" UUID NOT NULL,
    "processed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbox_pkey" PRIMARY KEY ("consumer","event_id")
);

-- CreateTable
CREATE TABLE "platform"."settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "platform"."feature_flags" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "rules" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_at_idx" ON "audit"."audit_log"("entity_type", "entity_id", "at");

-- CreateIndex
CREATE INDEX "audit_log_seq_idx" ON "audit"."audit_log"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "identity"."admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "admin_sessions_token_hash_key" ON "identity"."admin_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "admin_sessions_admin_user_id_idx" ON "identity"."admin_sessions"("admin_user_id");

-- CreateIndex
CREATE INDEX "admin_recovery_codes_admin_user_id_idx" ON "identity"."admin_recovery_codes"("admin_user_id");

-- AddForeignKey
ALTER TABLE "identity"."admin_user_roles" ADD CONSTRAINT "admin_user_roles_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "identity"."admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."admin_user_roles" ADD CONSTRAINT "admin_user_roles_role_code_fkey" FOREIGN KEY ("role_code") REFERENCES "identity"."roles"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."admin_sessions" ADD CONSTRAINT "admin_sessions_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "identity"."admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."admin_recovery_codes" ADD CONSTRAINT "admin_recovery_codes_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "identity"."admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------------
-- Elle yazılan kısım (Prisma'nın ifade edemedikleri)
-- ---------------------------------------------------------------------------------------------------

-- audit: zincir sırası, aylık bölümler, değiştirilemezlik (K47)
CREATE SEQUENCE "audit"."audit_log_seq" AS BIGINT;

CREATE TABLE "audit"."audit_log_default" PARTITION OF "audit"."audit_log" DEFAULT;

-- Verilen ayın bölümünü yoksa açar. Worker her ay bir sonraki ayı açar; default bölüm yalnız güvenlik ağıdır.
-- SECURITY DEFINER: dtd_app (worker) bölüm açabilir ama audit şemasında başka tablo oluşturamaz.
-- Bölüm üzerinden yapılan ekleme/okuma üst tablonun yetkisiyle denetlenir; bölüme ayrıca yetki gerekmez.
CREATE FUNCTION "audit"."ensure_month_partition"(p_month DATE) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, audit AS $$
DECLARE
  v_from DATE := date_trunc('month', p_month)::date;
  v_to   DATE := (date_trunc('month', p_month) + interval '1 month')::date;
  v_name TEXT := 'audit_log_' || to_char(v_from, 'YYYY_MM');
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'audit' AND c.relname = v_name
  ) THEN
    EXECUTE format(
      'CREATE TABLE audit.%I PARTITION OF audit.audit_log FOR VALUES FROM (%L) TO (%L)',
      v_name, v_from, v_to
    );
  END IF;
  RETURN v_name;
END;
$$;

SELECT "audit"."ensure_month_partition"(current_date);
SELECT "audit"."ensure_month_partition"((current_date + interval '1 month')::date);

-- Satır değiştirilemez: UPDATE ve DELETE her rol için reddedilir (sahip dahil). Saklama süresi dolan bölüm
-- DETACH + DROP ile kaldırılır (satır silme değil).
CREATE FUNCTION "audit"."reject_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log değiştirilemez (K47)' USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "audit_log_no_update" BEFORE UPDATE OR DELETE ON "audit"."audit_log"
  FOR EACH ROW EXECUTE FUNCTION "audit"."reject_mutation"();

-- platform: teslim bekleyen olaylar için kısmi indeks (A6)
CREATE INDEX "outbox_pending_idx" ON "platform"."outbox" ("next_attempt_at")
  WHERE "published_at" IS NULL AND "dead" = false;

-- identity: kontroller
ALTER TABLE "identity"."admin_users"
  ADD CONSTRAINT "admin_users_email_lower" CHECK ("email" = lower("email")),
  ADD CONSTRAINT "admin_users_status_chk" CHECK ("status" IN ('active', 'disabled'));
ALTER TABLE "identity"."admin_sessions"
  ADD CONSTRAINT "admin_sessions_stage_chk" CHECK ("stage" IN ('mfa_setup', 'mfa_verify', 'full'));
ALTER TABLE "audit"."audit_log"
  ADD CONSTRAINT "audit_log_actor_type_chk"
  CHECK ("actor_type" IN ('admin', 'system', 'adapter', 'ai', 'guest', 'user'));

INSERT INTO "identity"."roles" ("code", "name") VALUES
  ('platform_admin', 'Platform yöneticisi'),
  ('editor', 'Editör'),
  ('approver', 'Onaylayıcı');

-- Yetkiler: tablolar dtd_owner'ındır; uygulama dtd_app rolüyle çalışır.
-- dtd_app audit_log'a yalnız ekler ve okur (K47).
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'dtd_app') THEN
    GRANT USAGE ON SCHEMA "platform", "audit", "identity" TO dtd_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "platform" TO dtd_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "identity" TO dtd_app;
    GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA "audit" TO dtd_app;
    GRANT USAGE ON SEQUENCE "audit"."audit_log_seq" TO dtd_app;
    GRANT EXECUTE ON FUNCTION "audit"."ensure_month_partition"(DATE) TO dtd_app;
  END IF;
END
$$;
