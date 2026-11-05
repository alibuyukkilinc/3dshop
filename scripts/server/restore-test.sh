#!/usr/bin/env bash
# 3D-Shop aylık geri yükleme provası (K59). root olarak cron'dan: /etc/cron.d/dtd-backup
# Son gece dökümü geçici bir veritabanına açılır, temel tablolar denetlenir, veritabanı silinir. Sonuç
# ops.job_heartbeats'e ('restore_test') yazılır; hata olursa uyarı e-postası gider.
set -euo pipefail

APP=/srv/dtd/app
DIR=/srv/dtd/backups
TMPDB=dtd_restore_test
set -a; source "$APP/.env"; set +a

heartbeat() {
  psql "$DATABASE_MIGRATION_URL" -qAt -c \
    "INSERT INTO ops.job_heartbeats (job, ok, finished_at, detail) VALUES ('restore_test', $1, now(), '$2'::jsonb)
     ON CONFLICT (job) DO UPDATE SET ok = EXCLUDED.ok, finished_at = EXCLUDED.finished_at, detail = EXCLUDED.detail" \
    >/dev/null || true
}
cleanup() { sudo -u postgres dropdb --if-exists "$TMPDB" >/dev/null 2>&1 || true; }
fail() {
  cleanup
  heartbeat false "{\"error\": \"$1\"}"
  if [[ -n "${RESEND_API_KEY:-}" && -n "${ALERT_EMAIL_TO:-}" ]]; then
    curl -fsS --max-time 20 -X POST https://api.resend.com/emails -H "Authorization: Bearer $RESEND_API_KEY" \
      -H 'Content-Type: application/json' \
      --data-binary "{\"from\": \"${MAIL_FROM:-Dijital Ticaret Dünyası <info@firmaxi.com>}\", \"to\": [\"${ALERT_EMAIL_TO%%,*}\"], \"subject\": \"[${ENV_LABEL:-staging}] Geri yükleme provası başarısız\", \"text\": \"$1\"}" >/dev/null || true
  fi
  echo "Prova başarısız: $1"
  exit 1
}

LATEST=$(ls -1t "$DIR"/nightly-*.dump 2>/dev/null | head -1 || true)
[[ -n "$LATEST" ]] || fail "Döküm bulunamadı ($DIR)"

cleanup
sudo -u postgres createdb "$TMPDB" || fail "Geçici veritabanı açılamadı"
# Eklentiler süper kullanıcıyla önceden açılır (dökümdeki CREATE EXTENSION'lar sahip rolle başarısız olmasın)
for ext in postgis vector pg_trgm unaccent ltree citext; do
  sudo -u postgres psql -qd "$TMPDB" -c "CREATE EXTENSION IF NOT EXISTS $ext" >/dev/null
done
ERR=$(mktemp)
if ! sudo -u postgres pg_restore --no-owner --no-acl --dbname="$TMPDB" "$LATEST" 2>"$ERR"; then
  # Önceden açılan eklentilerin "already exists" uyarıları zararsızdır; başka hata varsa prova başarısız
  REAL=$(grep -iE "error" "$ERR" | grep -viE "already exists|errors ignored on restore" | head -1 || true)
  [[ -z "$REAL" ]] || { rm -f "$ERR"; fail "pg_restore hata verdi: ${REAL//\"/}"; }
fi
rm -f "$ERR"

ADMINS=$(sudo -u postgres psql -qAtd "$TMPDB" -c "SELECT count(*) FROM identity.admin_users") || fail "identity.admin_users okunamadı"
AUDIT=$(sudo -u postgres psql -qAtd "$TMPDB" -c "SELECT count(*) FROM audit.audit_log") || fail "audit.audit_log okunamadı"
MIGS=$(sudo -u postgres psql -qAtd "$TMPDB" -c "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL") || fail "göç tablosu okunamadı"
cleanup

heartbeat true "{\"file\": \"$(basename "$LATEST")\", \"admin_users\": $ADMINS, \"audit_rows\": $AUDIT, \"migrations\": $MIGS}"
echo "$(date -Is) prova tamam: $(basename "$LATEST") (yönetici $ADMINS, denetim $AUDIT, göç $MIGS)"
