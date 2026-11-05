-- F2.2 yayın: changeset, öğeler, onaylar, canlı işaretçi, geçmiş (K44). Kart 9BQH2JH834M8QPX2HC20.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "publishing";

-- CreateTable
CREATE TABLE "publishing"."changesets" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_by" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(3),
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "self_approved" BOOLEAN NOT NULL DEFAULT false,
    "self_approval_reason" TEXT,
    "scheduled_at" TIMESTAMPTZ(3),
    "published_at" TIMESTAMPTZ(3),
    "published_by" UUID,
    "rollback_of_id" UUID,
    "rolled_back_by_id" UUID,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "changesets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publishing"."changeset_items" (
    "id" UUID NOT NULL,
    "changeset_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "op" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "before" JSONB,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "changeset_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publishing"."approvals" (
    "id" UUID NOT NULL,
    "changeset_id" UUID NOT NULL,
    "approver_id" UUID NOT NULL,
    "decision" TEXT NOT NULL,
    "comment" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publishing"."publications" (
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "changeset_id" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "publications_pkey" PRIMARY KEY ("entity_type","entity_id")
);

-- CreateTable
CREATE TABLE "publishing"."publication_history" (
    "id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "changeset_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "by" UUID NOT NULL,

    CONSTRAINT "publication_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "changesets_status_scheduled_at_idx" ON "publishing"."changesets"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "changeset_items_changeset_id_idx" ON "publishing"."changeset_items"("changeset_id");

-- CreateIndex
CREATE INDEX "changeset_items_entity_type_entity_id_idx" ON "publishing"."changeset_items"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "approvals_changeset_id_idx" ON "publishing"."approvals"("changeset_id");

-- CreateIndex
CREATE INDEX "publication_history_entity_type_entity_id_at_idx" ON "publishing"."publication_history"("entity_type", "entity_id", "at");

-- AddForeignKey
ALTER TABLE "publishing"."changeset_items" ADD CONSTRAINT "changeset_items_changeset_id_fkey" FOREIGN KEY ("changeset_id") REFERENCES "publishing"."changesets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publishing"."approvals" ADD CONSTRAINT "approvals_changeset_id_fkey" FOREIGN KEY ("changeset_id") REFERENCES "publishing"."changesets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "publishing"."changesets"
  ADD CONSTRAINT "changesets_status_chk" CHECK ("status" IN ('draft', 'in_review', 'approved', 'scheduled', 'published', 'rejected', 'cancelled')),
  -- Kendi onayı yalnız gerekçeyle (K44, K13)
  ADD CONSTRAINT "changesets_self_approval_chk" CHECK (NOT "self_approved" OR ("self_approval_reason" IS NOT NULL AND length(btrim("self_approval_reason")) >= 10));
ALTER TABLE "publishing"."approvals"
  ADD CONSTRAINT "approvals_decision_chk" CHECK ("decision" IN ('approve', 'reject'));

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'dtd_app') THEN
    GRANT USAGE ON SCHEMA "publishing" TO dtd_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "publishing" TO dtd_app;
  END IF;
END
$$;
