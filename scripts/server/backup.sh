#!/usr/bin/env bash
# 3D-Shop gece yedeği (K59). dtd kullanıcısı olarak cron'dan: /etc/cron.d/dtd-backup
#
# - pg_dump (custom biçim) → /srv/dtd/backups/nightly-YYYYMMDD.dump; pazar günleri weekly-YYYYMMDD.dump
# - Yerelde 14 gecelik + 8 haftalık tutulur.
# - /srv/dtd/.bunny-backup.env varsa: döküm AES-256 ile şifrelenip Bunny Storage'a yüklenir, uzakta da aynı saklama.
# - Sonuç ops.job_heartbeats'e (panel → Sistem durumu) yazılır; hata olursa uyarı e-postası (Resend) gider.
set -euo pipefail

APP=/srv/dtd/app
DIR=/srv/dtd/backups
BUNNY_ENV=/srv/dtd/.bunny-backup.env
KEEP_NIGHTLY=14
KEEP_WEEKLY=8

set -a; source "$APP/.env"; set +a
DB_URL="$DATABASE_MIGRATION_URL"
STAMP="$(date +%Y%m%d)"
STAGE="başlangıç"

heartbeat() { # ok detail_json
  psql "$DB_URL" -qAt -v ON_ERROR_STOP=1 -c \
    "INSERT INTO ops.job_heartbeats (job, ok, finished_at, detail) VALUES ('backup', $1, now(), '$2'::jsonb)
     ON CONFLICT (job) DO UPDATE SET ok = EXCLUDED.ok, finished_at = EXCLUDED.finished_at, detail = EXCLUDED.detail" \
    >/dev/null || true
}

alert() { # konu metin
  [[ -n "${RESEND_API_KEY:-}" && -n "${ALERT_EMAIL_TO:-}" ]] || { echo "UYARI (e-posta yok): $1"; return 0; }
  python3 - "$1" "$2" <<'PY' | curl -fsS --max-time 20 -X POST https://api.resend.com/emails \
    -H "Authorization: Bearer $RESEND_API_KEY" -H 'Content-Type: application/json' --data-binary @- >/dev/null || true
import json, os, sys
to = [a.strip() for a in os.environ.get("ALERT_EMAIL_TO", "").split(",") if a.strip()]
print(json.dumps({"from": os.environ.get("MAIL_FROM", "Dijital Ticaret Dünyası <info@firmaxi.com>"),
                  "to": to, "subject": sys.argv[1], "text": sys.argv[2]}))
PY
}

on_error() {
  local line=$1
  echo "Yedek başarısız (adım: $STAGE, satır $line)"
  heartbeat false "{\"stage\": \"$STAGE\", \"line\": $line}"
  alert "[${ENV_LABEL:-staging}] Gece yedeği başarısız" \
    "Adım: $STAGE (satır $line). Sunucu: $(hostname). Günlük: /srv/dtd/backup.log"
}
trap 'on_error $LINENO' ERR

mkdir -p "$DIR"
STAGE="pg_dump"
FILE="$DIR/nightly-$STAMP.dump"
pg_dump --format=custom --compress=6 --file="$FILE.tmp" "$DB_URL"
mv "$FILE.tmp" "$FILE"
pg_restore --list "$FILE" >/dev/null   # döküm okunabilir mi
SIZE=$(stat -c %s "$FILE")
FILES=("$FILE")
if [[ "$(date +%u)" == "7" ]]; then
  cp "$FILE" "$DIR/weekly-$STAMP.dump"
  FILES+=("$DIR/weekly-$STAMP.dump")
fi

STAGE="yerel saklama"
prune() { # desen sayı — eşleşen dosya yoksa da hata vermez (pipefail altında ls'nin "yok" hatası yutulur)
  { ls -1t "$DIR"/$1 2>/dev/null || true; } | tail -n +$(($2 + 1)) | xargs -r rm --
}
prune 'nightly-*.dump' "$KEEP_NIGHTLY"
prune 'weekly-*.dump' "$KEEP_WEEKLY"

UPLOADED=false
if [[ -f "$BUNNY_ENV" ]]; then
  # BUNNY_STORAGE_ZONE, BUNNY_STORAGE_PASSWORD, BUNNY_STORAGE_HOST (örn. storage.bunnycdn.com), BACKUP_PASSPHRASE
  set -a; source "$BUNNY_ENV"; set +a
  HOST="${BUNNY_STORAGE_HOST:-storage.bunnycdn.com}"
  BASE="https://$HOST/$BUNNY_STORAGE_ZONE/${ENV_LABEL:-staging}"
  for f in "${FILES[@]}"; do
    STAGE="şifreleme ($(basename "$f"))"
    openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$f" -out "$f.enc" -pass env:BACKUP_PASSPHRASE
    STAGE="yükleme ($(basename "$f"))"
    curl -fsS --max-time 600 -X PUT "$BASE/$(basename "$f").enc" -H "AccessKey: $BUNNY_STORAGE_PASSWORD" \
      -H 'Content-Type: application/octet-stream' --data-binary @"$f.enc" >/dev/null
    rm -f "$f.enc"
  done
  STAGE="uzak saklama"
  curl -fsS --max-time 60 "$BASE/" -H "AccessKey: $BUNNY_STORAGE_PASSWORD" -H 'Accept: application/json' |
    python3 -c "
import json, sys
items = sorted((i['ObjectName'] for i in json.load(sys.stdin) if not i.get('IsDirectory')), reverse=True)
for prefix, keep in (('nightly-', $KEEP_NIGHTLY), ('weekly-', $KEEP_WEEKLY)):
    for name in [n for n in items if n.startswith(prefix)][keep:]:
        print(name)" |
    while read -r old; do
      curl -fsS --max-time 60 -X DELETE "$BASE/$old" -H "AccessKey: $BUNNY_STORAGE_PASSWORD" >/dev/null
    done
  UPLOADED=true
fi

STAGE="kayıt"
heartbeat true "{\"file\": \"$(basename "$FILE")\", \"bytes\": $SIZE, \"uploaded\": $UPLOADED}"
echo "$(date -Is) yedek tamam: $(basename "$FILE") ($SIZE bayt), Bunny: $UPLOADED"
