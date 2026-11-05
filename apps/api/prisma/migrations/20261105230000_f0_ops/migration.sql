-- F0.7: ops şeması — kendi hata kaydımız, uyarı kısıtlaması, zamanlanmış iş sonuçları.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "ops";

-- CreateTable
CREATE TABLE "ops"."error_events" (
    "fingerprint" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_context" JSONB,
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by" TEXT,

    CONSTRAINT "error_events_pkey" PRIMARY KEY ("fingerprint")
);

-- CreateTable
CREATE TABLE "ops"."alert_state" (
    "key" TEXT NOT NULL,
    "last_sent_at" TIMESTAMPTZ(3) NOT NULL,
    "sent_count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "alert_state_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ops"."job_heartbeats" (
    "job" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "finished_at" TIMESTAMPTZ(3) NOT NULL,
    "detail" JSONB,

    CONSTRAINT "job_heartbeats_pkey" PRIMARY KEY ("job")
);

-- CreateIndex
CREATE INDEX "error_events_resolved_at_last_seen_at_idx" ON "ops"."error_events"("resolved_at", "last_seen_at");

ALTER TABLE "ops"."error_events"
  ADD CONSTRAINT "error_events_source_chk" CHECK ("source" IN ('api', 'worker', 'web', 'job'));

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'dtd_app') THEN
    GRANT USAGE ON SCHEMA "ops" TO dtd_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "ops" TO dtd_app;
  END IF;
END
$$;
