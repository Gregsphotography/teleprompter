#!/usr/bin/env bash
#
# AeroPrompter visitor counter — one-shot installer.
#
#   sudo bash tracker/install.sh
#
# Safe to re-run: every step is idempotent. It checks prerequisites first and
# tells you exactly what is wrong rather than half-installing and failing later.

set -euo pipefail

# Overridable for testing; the defaults are what you want on a real server.
PREFIX="${PREFIX:-}"
APP_DIR="${PREFIX}/opt/aeroprompter-tracker"
ENV_FILE="${PREFIX}/etc/aeroprompter-tracker.env"
UNIT_FILE="${PREFIX}/etc/systemd/system/aeroprompter-tracker.service"
NGINX_CONF="${PREFIX}/etc/nginx/aeroprompter-tracker.conf"
HTPASSWD="${PREFIX}/etc/nginx/aeroprompter-stats.htpasswd"
DB_DIR="${PREFIX}/var/lib/aeroprompter"
SERVICE_USER="aeroprompter"
PORT=8787

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say()  { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31mError:\033[0m %s\n\n' "$*" >&2; exit 1; }

# --- 1. Prerequisites -------------------------------------------------------

say "Checking prerequisites"

[ "${SKIP_ROOT_CHECK:-0}" = "1" ] || [ "$(id -u)" -eq 0 ] || die "Run with sudo: sudo bash tracker/install.sh"

command -v node >/dev/null 2>&1 || die "Node is not installed, or not on root's PATH.
  Forge installs it for the deploy user. Try:  sudo ln -s \$(which node) /usr/bin/node"

NODE_VERSION="$(node -p 'process.versions.node')"
NODE_MAJOR="$(node -p 'parseInt(process.versions.node,10)')"

# Storage is a CSV file, so there is no SQLite and no exotic version floor.
# Anything with stable ESM will do.
[ "$NODE_MAJOR" -ge 16 ] || die "Node $NODE_VERSION is too old; 16+ needed. Upgrade with:
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt install -y nodejs"
ok "Node $NODE_VERSION"

for f in server.mjs stats.mjs store.mjs dashboard.mjs; do
  [ -f "$SRC_DIR/$f" ] || die "Missing $SRC_DIR/$f — run this from the repo checkout."
done
ok "Tracker sources found in $SRC_DIR"

# --- 2. Service account -----------------------------------------------------

say "Service account"
if id "$SERVICE_USER" >/dev/null 2>&1; then
  ok "User '$SERVICE_USER' already exists"
else
  useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
  ok "Created user '$SERVICE_USER'"
fi

# --- 3. Program files -------------------------------------------------------

say "Installing to $APP_DIR"
mkdir -p "$APP_DIR"
cp "$SRC_DIR"/server.mjs "$SRC_DIR"/stats.mjs "$SRC_DIR"/store.mjs "$SRC_DIR"/dashboard.mjs "$APP_DIR/"
ok "Copied 4 files"

mkdir -p "$DB_DIR"
chown "$SERVICE_USER":"$SERVICE_USER" "$DB_DIR" 2>/dev/null || true
chmod 700 "$DB_DIR"
ok "Data directory $DB_DIR (0700, owned by $SERVICE_USER)"

# --- 4. Configuration -------------------------------------------------------

say "Configuration"
if [ -f "$ENV_FILE" ]; then
  ok "$ENV_FILE already exists, leaving it alone"
else
  mkdir -p "$(dirname "$ENV_FILE")"
  cat > "$ENV_FILE" <<ENVEOF
TRACKER_HOST=127.0.0.1
TRACKER_PORT=$PORT
TRACKER_CSV=/var/lib/aeroprompter/hits.csv
# Set to 1 to store raw IPs instead of daily-rotating hashes.
# Read the "Storing raw IPs" section of README.md first.
TRACKER_STORE_RAW_IP=0
ENVEOF
  chmod 600 "$ENV_FILE"
  ok "Wrote $ENV_FILE"
fi

# --- 5. systemd service -----------------------------------------------------

say "systemd service"
mkdir -p "$(dirname "$UNIT_FILE")"
cat > "$UNIT_FILE" <<UNITEOF
[Unit]
Description=AeroPrompter visitor counter
After=network.target

[Service]
Type=simple
ExecStart=$(command -v node) /opt/aeroprompter-tracker/server.mjs
EnvironmentFile=/etc/aeroprompter-tracker.env
Restart=always
RestartSec=5

User=$SERVICE_USER
Group=$SERVICE_USER
StateDirectory=aeroprompter
StateDirectoryMode=0700

NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
RestrictAddressFamilies=AF_INET AF_INET6
LockPersonality=yes

[Install]
WantedBy=multi-user.target
UNITEOF
ok "Wrote $UNIT_FILE"

if [ "${SKIP_SYSTEMD:-0}" = "1" ]; then
  ok "Skipping systemctl (SKIP_SYSTEMD=1)"
else
  systemctl daemon-reload
  systemctl enable --now aeroprompter-tracker >/dev/null 2>&1 || true
  systemctl restart aeroprompter-tracker
  sleep 1
  if systemctl is-active --quiet aeroprompter-tracker; then
    ok "Service running"
  else
    printf '\n'
    systemctl status aeroprompter-tracker --no-pager --lines=20 || true
    die "Service failed to start — output above."
  fi
fi

# --- 6. Dashboard password --------------------------------------------------

say "Dashboard password"
if [ -f "$HTPASSWD" ]; then
  ok "$HTPASSWD already exists, leaving it alone (re-run htpasswd to change it)"
else
  mkdir -p "$(dirname "$HTPASSWD")"
  DASH_USER="${DASH_USER:-greg}"

  if [ -n "${DASH_PASS:-}" ]; then
    PASS="$DASH_PASS"
  else
    printf '    Choose a password for %s at https://aeroprompter.app/stats\n' "$DASH_USER"
    printf '    Password: '
    read -rs PASS; printf '\n'
    printf '    Again:    '
    read -rs PASS2; printf '\n'
    [ "$PASS" = "$PASS2" ] || die "Passwords did not match. Re-run the script."
    [ -n "$PASS" ] || die "Password was empty. Re-run the script."
  fi

  # openssl ships on every web server; apache2-utils often doesn't. Both produce
  # the Apache MD5 (apr1) format, which nginx reads natively.
  if command -v openssl >/dev/null 2>&1; then
    printf '%s:%s\n' "$DASH_USER" "$(openssl passwd -apr1 "$PASS")" > "$HTPASSWD"
  elif command -v htpasswd >/dev/null 2>&1; then
    htpasswd -bc "$HTPASSWD" "$DASH_USER" "$PASS" >/dev/null 2>&1
  else
    die "Need either openssl or htpasswd to hash the password. Install one:
  sudo apt install -y openssl"
  fi

  unset PASS PASS2
  chmod 640 "$HTPASSWD"
  chown root:www-data "$HTPASSWD" 2>/dev/null || true
  ok "Password set for user '$DASH_USER'"
fi

# --- 7. nginx snippet -------------------------------------------------------

say "nginx"
mkdir -p "$(dirname "$NGINX_CONF")"
cat > "$NGINX_CONF" <<NGINXEOF
# AeroPrompter visitor counter. Managed by tracker/install.sh — do not edit;
# your changes will be overwritten on the next run.

location = /api/hit {
    proxy_pass http://127.0.0.1:$PORT/hit;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$remote_addr;
    proxy_connect_timeout 2s;
    proxy_read_timeout 5s;
    access_log off;
}

location = /stats {
    auth_basic "AeroPrompter stats";
    auth_basic_user_file $HTPASSWD;
    proxy_pass http://127.0.0.1:$PORT/dashboard;
    proxy_set_header Host \$host;
}
NGINXEOF
ok "Wrote $NGINX_CONF"

# --- Done -------------------------------------------------------------------

if [ "${SKIP_SYSTEMD:-0}" != "1" ]; then
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    ok "Tracker responding on 127.0.0.1:$PORT"
  else
    die "Tracker is not responding on port $PORT. Check: journalctl -u aeroprompter-tracker -n 30"
  fi
fi

cat <<FINAL

────────────────────────────────────────────────────────────────────
 Almost done. One manual step left, because Forge owns the nginx
 config for your site and this script must not overwrite it.

 In Forge:  aeroprompter.app -> Edit Files -> Edit Nginx Configuration

 Add this ONE line inside the existing  server { ... }  block:

     include /etc/nginx/aeroprompter-tracker.conf;

 Save. Forge reloads nginx for you.

 Then your stats are at:   https://aeroprompter.app/stats
────────────────────────────────────────────────────────────────────

FINAL
