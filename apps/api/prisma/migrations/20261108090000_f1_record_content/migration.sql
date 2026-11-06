-- Kaynak kaydında son içerik: gece uzlaştırmasında hangi alanın değiştiği görülsün (K6 teşhisi).
ALTER TABLE "integration"."source_records" ADD COLUMN "content" JSONB;
