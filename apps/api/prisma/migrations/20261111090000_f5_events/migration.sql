-- F5.4: platform olayları (K15, K37) — aylık bölümlü ham olay tablosu ve günlük özet.
-- Kişisel veri yok: IP, kullanıcı, e-posta sütunu tanımlı değil; session_id yalnız rızayla üretilen rastgele UUID.

CREATE TABLE "analytics"."events" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "session_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "store_id" UUID,
    "product_id" UUID,
    "props" JSONB NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id","occurred_at")
) PARTITION BY RANGE ("occurred_at");

CREATE INDEX "events_name_occurred_at_idx" ON "analytics"."events"("name", "occurred_at");
CREATE INDEX "events_product_id_occurred_at_idx" ON "analytics"."events"("product_id", "occurred_at");

CREATE TABLE "analytics"."event_daily" (
    "day" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "events" INTEGER NOT NULL,
    "sessions" INTEGER NOT NULL,

    CONSTRAINT "event_daily_pkey" PRIMARY KEY ("day","name","subject")
);

-- ---------------------------------------------------------------------------------------------------
-- Elle yazılan kısım: bölümler ve saklama (K37). audit.ensure_month_partition ile aynı yaklaşım.
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE "analytics"."events_default" PARTITION OF "analytics"."events" DEFAULT;

-- Verilen ayın bölümünü yoksa açar. SECURITY DEFINER: dtd_app (worker) bölüm açabilir, başka tablo oluşturamaz.
CREATE FUNCTION "analytics"."ensure_events_partition"(p_month DATE) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, analytics AS $$
DECLARE
  v_from DATE := date_trunc('month', p_month)::date;
  v_to   DATE := (date_trunc('month', p_month) + interval '1 month')::date;
  v_name TEXT := 'events_' || to_char(v_from, 'YYYY_MM');
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'analytics' AND c.relname = v_name
  ) THEN
    EXECUTE format(
      'CREATE TABLE analytics.%I PARTITION OF analytics.events FOR VALUES FROM (%L) TO (%L)',
      v_name, v_from, v_to
    );
  END IF;
  RETURN v_name;
END;
$$;

-- Saklama süresi (K37: 13 ay) dolan aylık bölümleri ayırıp siler; satır silme yok. Silinen bölüm adlarını döner.
-- Yalnız events_YYYY_MM adlı bölümlere dokunur; default bölüm kalır.
CREATE FUNCTION "analytics"."drop_events_partitions_before"(p_month DATE) RETURNS SETOF TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, analytics AS $$
DECLARE
  v_cut TEXT := 'events_' || to_char(date_trunc('month', p_month), 'YYYY_MM');
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    JOIN pg_namespace n ON n.oid = p.relnamespace
    WHERE n.nspname = 'analytics' AND p.relname = 'events'
      AND c.relname ~ '^events_[0-9]{4}_[0-9]{2}$' AND c.relname < v_cut
  LOOP
    EXECUTE format('ALTER TABLE analytics.events DETACH PARTITION analytics.%I', r.relname);
    EXECUTE format('DROP TABLE analytics.%I', r.relname);
    RETURN NEXT r.relname;
  END LOOP;
END;
$$;

SELECT "analytics"."ensure_events_partition"(current_date);
SELECT "analytics"."ensure_events_partition"((current_date + interval '1 month')::date);

ALTER TABLE "analytics"."events"
  ADD CONSTRAINT "events_name_chk" CHECK ("name" ~ '^[a-z_]{2,40}$');

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'dtd_app') THEN
    -- Ham olay yalnız eklenir ve okunur (değiştirme/silme yok; saklama bölüm silmeyle)
    GRANT SELECT, INSERT ON "analytics"."events" TO dtd_app;
    GRANT SELECT, INSERT, DELETE ON "analytics"."event_daily" TO dtd_app;
    GRANT EXECUTE ON FUNCTION "analytics"."ensure_events_partition"(DATE) TO dtd_app;
    GRANT EXECUTE ON FUNCTION "analytics"."drop_events_partitions_before"(DATE) TO dtd_app;
  END IF;
END
$$;
