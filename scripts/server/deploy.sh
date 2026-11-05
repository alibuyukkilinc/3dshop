#!/usr/bin/env bash
# 3D-Shop: yeni sürümü yayına alır ("dtd" kullanıcısı olarak, repo içinden). Cortex K54, K59.
#
#   sudo -u dtd -H bash /srv/dtd/app/scripts/server/deploy.sh [dal]   (varsayılan: main)
#   (root kısayolu: bash /root/dtd-git.sh)
#
# Adımlar: kodu çek → bağımlılıklar → build (api + admin + web) → yayın öncesi yedek → göçler → pm2 reload
# → sağlık kontrolü → paneli yayın klasörüne kopyala. Bir adım hata verirse betik durur; çalışan süreçler
# eski sürümle devam eder.
set -euo pipefail

BRANCH="${1:-main}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ADMIN_ROOT=/srv/dtd/admin
BACKUP_DIR=/srv/dtd/backups

step() { echo; echo "==> $*"; }
cd "$ROOT"
[[ -f .env ]] || { echo ".env yok: önce scripts/server/setup.sh çalıştırılmalı."; exit 1; }
# Build anında gereken değişkenler (SITE_INDEXABLE, SITE_URL: robots ve meta derlemede üretilir)
set -a; source ./.env; set +a
API_PORT="${API_PORT:-3100}"

step "Kod çekiliyor ($BRANCH)"
git fetch --prune origin
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"
echo "Sürüm: $(git log -1 --format='%h %s')"

step "Bağımlılıklar"
# .env'deki NODE_ENV=production geliştirme bağımlılıklarını (vite, rolldown, typescript) atlatmasın: build onlara muhtaç
pnpm install --frozen-lockfile --prod=false

step "Build (api + admin + web)"
export NODE_OPTIONS="--max-old-space-size=3072"
pnpm --filter @dtd/api build
pnpm --filter @dtd/admin build
pnpm --filter @dtd/web build
unset NODE_OPTIONS
[[ -f apps/api/dist/main.js && -f apps/admin/dist/index.html && -d apps/web/.next ]] || { echo "Build çıktısı eksik."; exit 1; }

step "Yayın öncesi yedek"
mkdir -p "$BACKUP_DIR"
pg_dump --format=custom --file="$BACKUP_DIR/predeploy-$(date +%Y%m%d-%H%M%S).dump" "$DATABASE_MIGRATION_URL"
ls -1t "$BACKUP_DIR"/predeploy-*.dump | tail -n +11 | xargs -r rm --

step "Veritabanı göçleri"
pnpm --filter @dtd/api db:deploy

step "Süreçler (pm2)"
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save

step "Sağlık kontrolü"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${API_PORT}/api/readyz" >/dev/null 2>&1 && curl -fsS "http://127.0.0.1:3101/healthz" >/dev/null 2>&1; then
    echo "API ve web ayakta."
    break
  fi
  [[ $i -eq 30 ]] && { echo "30 sn içinde yanıt yok: pm2 logs dtd-api / dtd-web"; exit 1; }
  sleep 1
done

step "Yönetim paneli yayınlanıyor"
mkdir -p "$ADMIN_ROOT/assets"
rsync -a apps/admin/dist/assets/ "$ADMIN_ROOT/assets/"
rsync -a --exclude assets --exclude index.html apps/admin/dist/ "$ADMIN_ROOT/"
cp apps/admin/dist/index.html "$ADMIN_ROOT/index.html.tmp" && mv "$ADMIN_ROOT/index.html.tmp" "$ADMIN_ROOT/index.html"
find "$ADMIN_ROOT/assets" -type f -mtime +30 -delete

echo
echo "Yayında: $(git log -1 --format='%h %s')"
pm2 status
