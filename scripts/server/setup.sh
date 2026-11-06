#!/usr/bin/env bash
# 3D-Shop staging ortamını finans-prod üzerinde kurar (root olarak, bir kez; tekrar çalıştırılabilir). Cortex K54, K55, K59.
#
#   bash setup.sh            # 1. aşama: paketler, dtd kullanıcısı, veritabanı, Redis, deploy key
#   bash setup.sh --deploy   # 2. aşama (deploy key GitHub'a eklendikten sonra): klon, .env, ilk yayın, nginx, pm2 açılışı
#
# Dokunduğu şeyler: apt paketleri (postgresql-17-postgis-3, postgresql-17-pgvector, redis-server, apache2-utils),
# dtd kullanıcısı (/srv/dtd), PostgreSQL rolleri dtd_owner/dtd_app ve dtd_staging veritabanı, Redis yapılandırması,
# /etc/nginx/sites-available/dtd-staging, /etc/nginx/snippets/dtd-cloudflare-realip.conf, /etc/nginx/dtd-staging.htpasswd,
# pm2-dtd systemd servisi, /root/dtd-git.sh. Finans (/srv/finans) ve Cortex (/srv/cortex) ayarlarına dokunmaz.
set -euo pipefail

REPO=git@github.com:alibuyukkilinc/3dshop.git
HOME_DIR=/srv/dtd
APP="$HOME_DIR/app"
DB=dtd_staging
SECRETS=/root/dtd-staging-secrets.txt

[[ $EUID -eq 0 ]] || { echo "root olarak çalıştırın."; exit 1; }
step() { echo; echo "==> $*"; }
rand() { openssl rand -base64 "$1" | tr -d '+/=\n' | cut -c1-"$2"; }

if [[ "${1:-}" != "--deploy" ]]; then
  step "Paketler"
  DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql-17-postgis-3 postgresql-17-pgvector redis-server apache2-utils rsync

  step "dtd kullanıcısı"
  id dtd >/dev/null 2>&1 || useradd --system --create-home --home-dir "$HOME_DIR" --shell /bin/bash dtd
  install -d -o dtd -g dtd -m 750 "$HOME_DIR" "$HOME_DIR/backups"
  install -d -o dtd -g www-data -m 750 "$HOME_DIR/admin"
  chmod 751 "$HOME_DIR"   # nginx (www-data) /srv/dtd/admin'e erişebilsin

  step "Veritabanı ($DB)"
  touch "$SECRETS" && chmod 600 "$SECRETS"
  grep -q '^DTD_OWNER_PASS=' "$SECRETS" || echo "DTD_OWNER_PASS=$(rand 32 32)" >>"$SECRETS"
  grep -q '^DTD_APP_PASS=' "$SECRETS" || echo "DTD_APP_PASS=$(rand 32 32)" >>"$SECRETS"
  grep -q '^REDIS_PASS=' "$SECRETS" || echo "REDIS_PASS=$(rand 32 32)" >>"$SECRETS"
  grep -q '^BASIC_AUTH_PASS=' "$SECRETS" || echo "BASIC_AUTH_PASS=$(rand 24 20)" >>"$SECRETS"
  # shellcheck disable=SC1090
  source "$SECRETS"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dtd_owner') THEN
    CREATE ROLE dtd_owner LOGIN CONNECTION LIMIT 10 PASSWORD '$DTD_OWNER_PASS';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dtd_app') THEN
    CREATE ROLE dtd_app LOGIN CONNECTION LIMIT 40 PASSWORD '$DTD_APP_PASS';
  END IF;
END
\$\$;
GRANT dtd_app TO dtd_owner;
SELECT 'CREATE DATABASE $DB OWNER dtd_owner' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$DB')\gexec
REVOKE ALL ON DATABASE $DB FROM PUBLIC;
GRANT CONNECT ON DATABASE $DB TO dtd_owner, dtd_app;
SQL
  # Eklentiler süper kullanıcı ister; F1/F3 göçleri hazır bulur (K30, K35)
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS ltree;
CREATE EXTENSION IF NOT EXISTS citext;
SQL

  step "Redis (yalnız localhost, ACL kullanıcısı dtd, 1 GB)"
  RCONF=/etc/redis/redis.conf
  grep -q '^# dtd-ayarlar' "$RCONF" || cat >>"$RCONF" <<EOF

# dtd-ayarlar (3D-Shop setup.sh)
bind 127.0.0.1 -::1
protected-mode yes
maxmemory 1gb
maxmemory-policy noeviction
aclfile /etc/redis/users.acl
EOF
  install -o redis -g redis -m 640 /dev/null /etc/redis/users.acl
  printf 'user default off\nuser dtd on >%s ~* &* +@all -@dangerous\n' "$REDIS_PASS" >/etc/redis/users.acl
  systemctl enable --now redis-server
  systemctl restart redis-server

  step "GitHub deploy key (salt okunur)"
  if [[ ! -f "$HOME_DIR/.ssh/id_ed25519" ]]; then
    sudo -u dtd -H bash -c "mkdir -p ~/.ssh && chmod 700 ~/.ssh && ssh-keygen -q -t ed25519 -N '' -C 'dtd@finans-prod deploy' -f ~/.ssh/id_ed25519 && ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts 2>/dev/null"
  fi
  echo
  echo "Bu açık anahtarı GitHub'da alibuyukkilinc/3dshop → Settings → Deploy keys → Add (Allow write access KAPALI) olarak ekleyin:"
  cat "$HOME_DIR/.ssh/id_ed25519.pub"
  echo
  echo "Sonra: bash setup.sh --deploy"
  exit 0
fi

# ---------------------------------------------------------------------------------------- 2. aşama
# shellcheck disable=SC1090
source "$SECRETS"

step "Kod"
if [[ ! -d "$APP/.git" ]]; then
  sudo -u dtd -H git clone "$REPO" "$APP"
fi

step ".env"
if [[ ! -f "$APP/.env" ]]; then
  install -o dtd -g dtd -m 600 /dev/null "$APP/.env"
  cat >"$APP/.env" <<EOF
NODE_ENV=production
API_PORT=3100
DATABASE_URL=postgresql://dtd_app:$DTD_APP_PASS@127.0.0.1:5432/$DB
DATABASE_MIGRATION_URL=postgresql://dtd_owner:$DTD_OWNER_PASS@127.0.0.1:5432/$DB
APP_ORIGINS=https://staging.firmaxi.com
COOKIE_SECURE=true
TRUST_PROXY=1
ADMIN_SESSION_TTL_HOURS=12
SECRETS_KEY=$(openssl rand -base64 32)
TOTP_ISSUER=firmaxi-staging
REDIS_URL=redis://dtd:$REDIS_PASS@127.0.0.1:6379/0
SITE_URL=https://staging.firmaxi.com
SITE_INDEXABLE=false
ENV_LABEL=staging
ALERT_EMAIL_TO=
RESEND_API_KEY=
ASSETS_DIR=/srv/dtd/assets
EOF
fi
# 3D varlık deposu (F3.2): içerik adresli dosyalar, depo klasörünün dışında (deploy dokunmaz)
install -d -o dtd -g dtd -m 750 /srv/dtd/assets
grep -q '^ASSETS_DIR=' "$APP/.env" || echo 'ASSETS_DIR=/srv/dtd/assets' >>"$APP/.env"

step "Yedek ve geri yükleme provası (cron)"
cat >/etc/cron.d/dtd-backup <<'EOF'
# 3D-Shop (K59): gece yedeği 03:15, her ayın 1'inde 04:40 geri yükleme provası
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
15 3 * * * dtd bash /srv/dtd/app/scripts/server/backup.sh >> /srv/dtd/backup.log 2>&1
40 4 1 * * root bash /srv/dtd/app/scripts/server/restore-test.sh >> /srv/dtd/restore-test.log 2>&1
EOF
chmod 644 /etc/cron.d/dtd-backup
touch /srv/dtd/backup.log /srv/dtd/restore-test.log && chown dtd:dtd /srv/dtd/backup.log /srv/dtd/restore-test.log

step "İlk yayın"
sudo -u dtd -H bash "$APP/scripts/server/deploy.sh" main

step "pm2 açılışta başlasın (pm2-dtd)"
env PATH="$PATH:/usr/bin" pm2 startup systemd -u dtd --hp "$HOME_DIR" >/dev/null
systemctl enable pm2-dtd >/dev/null 2>&1 || true

step "nginx"
{
  echo "# Cloudflare IP aralıkları (setup.sh tarafından $(date +%F) indirildi)"
  for ip in $(curl -fsS https://www.cloudflare.com/ips-v4) $(curl -fsS https://www.cloudflare.com/ips-v6); do echo "set_real_ip_from $ip;"; done
  echo "real_ip_header CF-Connecting-IP;"
} >/etc/nginx/snippets/dtd-cloudflare-realip.conf
htpasswd -bcB /etc/nginx/dtd-staging.htpasswd dtd "$BASIC_AUTH_PASS" >/dev/null
chown root:www-data /etc/nginx/dtd-staging.htpasswd && chmod 640 /etc/nginx/dtd-staging.htpasswd
if [[ ! -f /etc/nginx/sites-available/dtd-staging ]]; then
  cp "$APP/scripts/server/nginx-staging.conf" /etc/nginx/sites-available/dtd-staging
  ln -sf /etc/nginx/sites-available/dtd-staging /etc/nginx/sites-enabled/dtd-staging
fi
nginx -t && systemctl reload nginx

step "Sertifika (certbot)"
certbot --nginx -d staging.firmaxi.com --non-interactive --agree-tos --redirect --keep-until-expiring \
  --register-unsafely-without-email || echo "certbot başarısız: DNS kaydını kontrol edip 'certbot --nginx -d staging.firmaxi.com' çalıştırın."

step "Yayın kısayolu"
cat >/root/dtd-git.sh <<'EOF'
#!/usr/bin/env bash
# 3D-Shop: GitHub'dan son kodu çekip yayına alır.  Kullanım: bash dtd-git.sh [dal]  (varsayılan: main)
set -euo pipefail
sudo -u dtd -H bash /srv/dtd/app/scripts/server/deploy.sh "${1:-main}" 2>&1 | tee -a /srv/dtd/deploy-github.log
EOF
chmod 700 /root/dtd-git.sh

echo
echo "Hazır: https://staging.firmaxi.com (basic auth kullanıcısı: dtd, parola: $SECRETS içinde BASIC_AUTH_PASS)"
echo "Yönetici açmak: sudo -u dtd -H bash -c 'cd $APP && pnpm admin:create -- --email <e-posta> --name \"<ad>\"'"
