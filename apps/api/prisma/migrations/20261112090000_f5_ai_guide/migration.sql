-- F5.2: AI rehber sohbetleri (K52). 30 gün saklanır (worker siler); kişisel veri istenmez.
CREATE SCHEMA IF NOT EXISTS "discovery";

CREATE TABLE "discovery"."ai_sessions" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "turns" INTEGER NOT NULL DEFAULT 0,
    "messages" JSONB NOT NULL,
    "seen_product_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    "model" TEXT NOT NULL,

    CONSTRAINT "ai_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_sessions_updated_at_idx" ON "discovery"."ai_sessions"("updated_at");

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'dtd_app') THEN
    GRANT USAGE ON SCHEMA "discovery" TO dtd_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "discovery"."ai_sessions" TO dtd_app;
  END IF;
END
$$;
