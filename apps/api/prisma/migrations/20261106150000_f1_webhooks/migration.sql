-- F1.4 webhook alıcısı: site başına imza sırrı ve gelen kutusu (B2, K42). Kart 8HZ12F6D497EYPBS4KRH.

-- AlterTable
ALTER TABLE "integration"."source_sites" ADD COLUMN     "webhook_secret_enc" TEXT;

-- CreateTable
CREATE TABLE "integration"."webhook_inbox" (
    "id" UUID NOT NULL,
    "source_site_id" UUID NOT NULL,
    "event_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "processed_at" TIMESTAMPTZ(3),
    "error" TEXT,

    CONSTRAINT "webhook_inbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_inbox_status_received_at_idx" ON "integration"."webhook_inbox"("status", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_inbox_source_site_id_event_id_key" ON "integration"."webhook_inbox"("source_site_id", "event_id");

-- AddForeignKey
ALTER TABLE "integration"."webhook_inbox" ADD CONSTRAINT "webhook_inbox_source_site_id_fkey" FOREIGN KEY ("source_site_id") REFERENCES "integration"."source_sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "integration"."webhook_inbox"
  ADD CONSTRAINT "webhook_inbox_status_chk" CHECK ("status" IN ('pending', 'processed', 'failed', 'deferred'));

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'dtd_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "integration" TO dtd_app;
  END IF;
END
$$;
