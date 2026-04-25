#!/usr/bin/env bash
# =============================================================================
#  Target: Debian/Linux VPS (root)
#  Usage:  bash install.sh --repo <repo_url> --domain <domain> --email <email>
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERR]${NC}  $*"; exit 1; }
step()    { echo -e "\n${CYAN}=== $* ===${NC}"; }

is_placeholder_domain() {
  case "${1:-}" in
    ""|chat.yourdomain.com|chat.example.com|example.com) return 0 ;;
    *) return 1 ;;
  esac
}

is_placeholder_email() {
  case "${1:-}" in
    ""|you@example.com|example@example.com) return 0 ;;
    *) return 1 ;;
  esac
}

INSTALL_DIR="/opt/conjiweb"
APP_USER="conjiweb"
MINIO_USER="minio-user"
DOMAIN=""
EMAIL=""
SRC_DIR=""
RUN_LOCAL=0
REPO_URL=""
BRANCH="main"
PROJECT_PATH=""
TARGET_DIR="/opt/conjiweb-src"
SSH_PORT="${SSH_PORT:-}"
XMPP_ADMIN_USER="admin"
XMPP_ADMIN_PASS="${XMPP_ADMIN_PASS:-}"
XMPP_ADMIN_CREATED=0
XMPP_ADMIN_JID=""
BACKUP_REMOTE="${BACKUP_REMOTE:-}"
PUBLIC_DOMAIN="${PUBLIC_DOMAIN:-}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-}"
AI_API_KEY="${AI_API_KEY:-}"
AI_BASE_URL="${AI_BASE_URL:-}"
AI_MODEL="${AI_MODEL:-}"
ALERT_EMAIL="${ALERT_EMAIL:-}"
DB_POOL_SIZE="${DB_POOL_SIZE:-10}"
DB_MAX_OVERFLOW="${DB_MAX_OVERFLOW:-20}"
DB_POOL_TIMEOUT="${DB_POOL_TIMEOUT:-30}"
DB_POOL_RECYCLE="${DB_POOL_RECYCLE:-1800}"

ensure_service_users() {
  if ! id -u "${APP_USER}" >/dev/null 2>&1; then
    useradd -r -s /usr/sbin/nologin "${APP_USER}"
  fi
  if ! id -u "${MINIO_USER}" >/dev/null 2>&1; then
    useradd -r -s /usr/sbin/nologin "${MINIO_USER}"
  fi
}

bootstrap_usage() {
  cat <<'EOF'
Usage:
  bash install.sh --repo <github_repo_url> --domain <your_domain> --email <your_email> [options]

Required:
  --repo      Git repository URL, for example: https://github.com/stone086/Conjiweb.git
  --domain    Public domain, for example: chat.example.com
  --email     Email for Let's Encrypt certificate notices

Optional:
  --branch    Git branch to install from (default: main)
  --path      Project path inside repo; auto-detected if omitted
  --target    Clone target directory (default: /opt/conjiweb-src)
  --ssh-port  SSH port(s) to keep open in UFW, supports comma/space list (default: auto-detect)
  --run-local Internal mode. Do not set manually.
  --help      Show this help
EOF
}

parse_bootstrap_args() {
  # Repo-local mode: allow direct `bash install.sh` without parameters.
  if [[ $# -eq 0 && -f ".env.example" && -d "apps/api" && -d "apps/web" ]]; then
    RUN_LOCAL=1
    return
  fi

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --repo) REPO_URL="${2:-}"; shift 2 ;;
      --domain) DOMAIN="${2:-}"; shift 2 ;;
      --email) EMAIL="${2:-}"; shift 2 ;;
      --branch) BRANCH="${2:-}"; shift 2 ;;
      --path) PROJECT_PATH="${2:-}"; shift 2 ;;
      --target) TARGET_DIR="${2:-}"; shift 2 ;;
      --ssh-port) SSH_PORT="${2:-}"; shift 2 ;;
      --run-local) RUN_LOCAL=1; shift ;;
      --help|-h) bootstrap_usage; exit 0 ;;
      *) error "Unknown option: $1" ;;
    esac
  done
}

bootstrap_if_needed() {
  if [[ "$RUN_LOCAL" -eq 1 ]]; then
    return
  fi

  [[ -n "$REPO_URL" ]] || { bootstrap_usage; error "--repo is required"; }
  if is_placeholder_domain "$DOMAIN" && [[ -t 0 ]]; then
    read -rp "Enter your real domain (for example: chat.yourdomain.com): " DOMAIN
    DOMAIN="${DOMAIN// /}"
  fi
  if is_placeholder_email "$EMAIL" && [[ -t 0 ]]; then
    read -rp "Enter your email for SSL certificate notices: " EMAIL
    EMAIL="${EMAIL// /}"
  fi
  is_placeholder_domain "$DOMAIN" && { bootstrap_usage; error "--domain is required and must not be a placeholder"; }
  is_placeholder_email "$EMAIL" && { bootstrap_usage; error "--email is required and must not be a placeholder"; }
  [[ "$(id -u)" -eq 0 ]] || error "Please run as root"

  info "Preparing dependencies..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq git ca-certificates

  if [[ -d "$TARGET_DIR/.git" ]]; then
    info "Existing source detected, refreshing: $TARGET_DIR"
    git -C "$TARGET_DIR" fetch --all --prune
    git -C "$TARGET_DIR" reset --hard "origin/$BRANCH"
  else
    info "Cloning $REPO_URL ($BRANCH) into $TARGET_DIR"
    rm -rf "$TARGET_DIR"
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$TARGET_DIR"
  fi

  local install_src
  if [[ -n "$PROJECT_PATH" ]]; then
    install_src="$TARGET_DIR/$PROJECT_PATH"
  elif [[ -f "$TARGET_DIR/install.sh" ]]; then
    install_src="$TARGET_DIR"
  elif [[ -f "$TARGET_DIR/web_Conji_native/install.sh" ]]; then
    install_src="$TARGET_DIR/web_Conji_native"
  else
    error "Cannot find install.sh. Use --path to specify project directory inside repo."
  fi

  cd "$install_src"
  [[ -f ".env.example" ]] || error ".env.example not found in $install_src"
  [[ -f "install.sh" ]] || error "install.sh not found in $install_src"

  if [[ ! -f ".env" ]]; then
    cp .env.example .env
  fi

  set_env() {
    local key="$1"
    local value="$2"
    if grep -qE "^${key}=" .env; then
      sed -i "s|^${key}=.*|${key}=${value}|" .env
    else
      echo "${key}=${value}" >> .env
    fi
  }

  set_env "DOMAIN" "$DOMAIN"
  set_env "EMAIL" "$EMAIL"
  CURRENT_XMPP_DOMAIN="$(grep -E '^XMPP_DOMAIN=' .env | head -n1 | cut -d= -f2- || true)"
  if [[ -z "$CURRENT_XMPP_DOMAIN" ]] || is_placeholder_domain "$CURRENT_XMPP_DOMAIN"; then
    set_env "XMPP_DOMAIN" "$DOMAIN"
  fi

  chmod +x install.sh manage.sh
  info "Starting install in $install_src"
  if [[ -n "${SSH_PORT:-}" ]]; then
    exec bash install.sh --run-local --ssh-port "$SSH_PORT"
  fi
  exec bash install.sh --run-local
}

load_config() {
  if [ ! -f ".env" ]; then
    error ".env file not found. Run: cp .env.example .env and fill required values."
  fi
  # Normalize CRLF to LF to avoid hidden '\r' in secrets.
  sed -i 's/\r$//' .env
  # shellcheck disable=SC1091
  set -a; source .env; set +a

  DOMAIN="${DOMAIN:-}"
  PUBLIC_DOMAIN="${PUBLIC_DOMAIN:-${DOMAIN}}"
  EMAIL="${EMAIL:-}"
  DB_PASS="${DB_PASS:-$(openssl rand -hex 16)}"
  REDIS_PASS="${REDIS_PASS:-$(openssl rand -hex 16)}"
  MINIO_ROOT_USER="${MINIO_ROOT_USER:-minioadmin}"
  MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-$(openssl rand -hex 16)}"
  SECRET_KEY="${SECRET_KEY:-$(openssl rand -hex 32)}"
  XMPP_DOMAIN="${XMPP_DOMAIN:-localhost}"
  XMPP_ADMIN_PASS="${XMPP_ADMIN_PASS:-$(openssl rand -hex 12)}"
  ADMIN_USER="${ADMIN_USER:-admin}"
  ADMIN_PASS="${ADMIN_PASS:-$(openssl rand -hex 12)}"
  AI_API_KEY="${AI_API_KEY:-}"
  AI_BASE_URL="${AI_BASE_URL:-}"
  AI_MODEL="${AI_MODEL:-}"
  ALERT_EMAIL="${ALERT_EMAIL:-}"
  DB_POOL_SIZE="${DB_POOL_SIZE:-10}"
  DB_MAX_OVERFLOW="${DB_MAX_OVERFLOW:-20}"
  DB_POOL_TIMEOUT="${DB_POOL_TIMEOUT:-30}"
  DB_POOL_RECYCLE="${DB_POOL_RECYCLE:-1800}"

  # Strip accidental CR characters from sourced values.
  DOMAIN="${DOMAIN//$'\r'/}"
  EMAIL="${EMAIL//$'\r'/}"
  DB_PASS="${DB_PASS//$'\r'/}"
  REDIS_PASS="${REDIS_PASS//$'\r'/}"
  MINIO_ROOT_USER="${MINIO_ROOT_USER//$'\r'/}"
  MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD//$'\r'/}"
  SECRET_KEY="${SECRET_KEY//$'\r'/}"
  XMPP_DOMAIN="${XMPP_DOMAIN//$'\r'/}"
  XMPP_ADMIN_PASS="${XMPP_ADMIN_PASS//$'\r'/}"
  BACKUP_REMOTE="${BACKUP_REMOTE//$'\r'/}"
  PUBLIC_DOMAIN="${PUBLIC_DOMAIN//$'\r'/}"
  ADMIN_USER="${ADMIN_USER//$'\r'/}"
  ADMIN_PASS="${ADMIN_PASS//$'\r'/}"
  AI_API_KEY="${AI_API_KEY//$'\r'/}"
  AI_BASE_URL="${AI_BASE_URL//$'\r'/}"
  AI_MODEL="${AI_MODEL//$'\r'/}"
  ALERT_EMAIL="${ALERT_EMAIL//$'\r'/}"
  DB_POOL_SIZE="${DB_POOL_SIZE//$'\r'/}"
  DB_MAX_OVERFLOW="${DB_MAX_OVERFLOW//$'\r'/}"
  DB_POOL_TIMEOUT="${DB_POOL_TIMEOUT//$'\r'/}"
  DB_POOL_RECYCLE="${DB_POOL_RECYCLE//$'\r'/}"

  DB_PASS_SQL_ESCAPED="${DB_PASS//\'/\'\'}"
  DB_PASS_URLENCODED="$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "${DB_PASS}")"

  if is_placeholder_domain "$DOMAIN" && [[ -t 0 ]]; then
    read -rp "Enter your real domain (for example: chat.yourdomain.com): " DOMAIN
    DOMAIN="${DOMAIN// /}"
  fi
  if is_placeholder_email "$EMAIL" && [[ -t 0 ]]; then
    read -rp "Enter your email for SSL certificate notices: " EMAIL
    EMAIL="${EMAIL// /}"
  fi
  is_placeholder_domain "$DOMAIN" && error "Please set a real DOMAIN value in .env (current: ${DOMAIN:-empty})"
  is_placeholder_email "$EMAIL" && error "Please set a real EMAIL value in .env (current: ${EMAIL:-empty})"

  # Persist generated secrets back to .env.
  sed -i "s|^DB_PASS=.*|DB_PASS=${DB_PASS}|" .env
  sed -i "s|^REDIS_PASS=.*|REDIS_PASS=${REDIS_PASS}|" .env
  sed -i "s|^MINIO_ROOT_PASSWORD=.*|MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}|" .env
  sed -i "s|^SECRET_KEY=.*|SECRET_KEY=${SECRET_KEY}|" .env
  if grep -qE '^XMPP_ADMIN_PASS=' .env; then
    sed -i "s|^XMPP_ADMIN_PASS=.*|XMPP_ADMIN_PASS=${XMPP_ADMIN_PASS}|" .env
  else
    echo "XMPP_ADMIN_PASS=${XMPP_ADMIN_PASS}" >> .env
  fi
  if grep -qE '^BACKUP_REMOTE=' .env; then
    sed -i "s|^BACKUP_REMOTE=.*|BACKUP_REMOTE=${BACKUP_REMOTE}|" .env
  else
    echo "BACKUP_REMOTE=${BACKUP_REMOTE}" >> .env
  fi
  if grep -qE '^PUBLIC_DOMAIN=' .env; then
    sed -i "s|^PUBLIC_DOMAIN=.*|PUBLIC_DOMAIN=${PUBLIC_DOMAIN}|" .env
  else
    echo "PUBLIC_DOMAIN=${PUBLIC_DOMAIN}" >> .env
  fi
  if grep -qE '^ADMIN_USER=' .env; then
    sed -i "s|^ADMIN_USER=.*|ADMIN_USER=${ADMIN_USER}|" .env
  else
    echo "ADMIN_USER=${ADMIN_USER}" >> .env
  fi
  if grep -qE '^ADMIN_PASS=' .env; then
    sed -i "s|^ADMIN_PASS=.*|ADMIN_PASS=${ADMIN_PASS}|" .env
  else
    echo "ADMIN_PASS=${ADMIN_PASS}" >> .env
  fi
  if grep -qE '^AI_API_KEY=' .env; then
    sed -i "s|^AI_API_KEY=.*|AI_API_KEY=${AI_API_KEY}|" .env
  else
    echo "AI_API_KEY=${AI_API_KEY}" >> .env
  fi
  if grep -qE '^AI_BASE_URL=' .env; then
    sed -i "s|^AI_BASE_URL=.*|AI_BASE_URL=${AI_BASE_URL}|" .env
  else
    echo "AI_BASE_URL=${AI_BASE_URL}" >> .env
  fi
  if grep -qE '^AI_MODEL=' .env; then
    sed -i "s|^AI_MODEL=.*|AI_MODEL=${AI_MODEL}|" .env
  else
    echo "AI_MODEL=${AI_MODEL}" >> .env
  fi
  if grep -qE '^ALERT_EMAIL=' .env; then
    sed -i "s|^ALERT_EMAIL=.*|ALERT_EMAIL=${ALERT_EMAIL}|" .env
  else
    echo "ALERT_EMAIL=${ALERT_EMAIL}" >> .env
  fi
  if grep -qE '^DB_POOL_SIZE=' .env; then
    sed -i "s|^DB_POOL_SIZE=.*|DB_POOL_SIZE=${DB_POOL_SIZE}|" .env
  else
    echo "DB_POOL_SIZE=${DB_POOL_SIZE}" >> .env
  fi
  if grep -qE '^DB_MAX_OVERFLOW=' .env; then
    sed -i "s|^DB_MAX_OVERFLOW=.*|DB_MAX_OVERFLOW=${DB_MAX_OVERFLOW}|" .env
  else
    echo "DB_MAX_OVERFLOW=${DB_MAX_OVERFLOW}" >> .env
  fi
  if grep -qE '^DB_POOL_TIMEOUT=' .env; then
    sed -i "s|^DB_POOL_TIMEOUT=.*|DB_POOL_TIMEOUT=${DB_POOL_TIMEOUT}|" .env
  else
    echo "DB_POOL_TIMEOUT=${DB_POOL_TIMEOUT}" >> .env
  fi
  if grep -qE '^DB_POOL_RECYCLE=' .env; then
    sed -i "s|^DB_POOL_RECYCLE=.*|DB_POOL_RECYCLE=${DB_POOL_RECYCLE}|" .env
  else
    echo "DB_POOL_RECYCLE=${DB_POOL_RECYCLE}" >> .env
  fi
  chmod 600 .env
}

check_system() {
  step "System checks"
  [ "$(id -u)" -eq 0 ] || error "Please run as root"

  OS=$(grep -oP '(?<=^ID=).+' /etc/os-release | tr -d '"')
  VER=$(grep -oP '(?<=^VERSION_ID=).+' /etc/os-release | tr -d '"')
  [ "$OS" = "debian" ] && [ "$VER" = "12" ] || warn "Debian 12 is recommended, current: $OS $VER"

  MEM=$(free -m | awk '/^Mem:/{print $2}')
  info "Memory: ${MEM}MB"
  [ "$MEM" -lt 1500 ] && warn "Memory is below 1.5GB; stability may be affected"

  success "System checks passed"
}

setup_apt_mirror() {
  step "Configure apt mirror"
  cat > /etc/apt/sources.list << 'EOF'
deb http://deb.debian.org/debian/ bookworm main contrib non-free non-free-firmware
deb http://deb.debian.org/debian/ bookworm-updates main contrib non-free non-free-firmware
deb http://security.debian.org/debian-security bookworm-security main contrib non-free non-free-firmware
EOF
  apt update -qq
  success "apt mirror configured (geo-aware deb.debian.org)"
}

upgrade_system_packages() {
  step "Upgrade system packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get -y -qq upgrade
  if [[ -f /var/run/reboot-required ]]; then
    warn "A reboot is required after package upgrade."
    warn "Please reboot and rerun installer: bash install.sh --run-local"
    exit 1
  fi
  success "System package upgrade completed"
}

install_deps() {
  step "Install system dependencies"
  apt install -y -qq \
    curl wget git unzip build-essential \
    ca-certificates gnupg lsb-release \
    openssl htop vim ufw fail2ban \
    python3.11 python3.11-venv python3-pip \
    libpq-dev libssl-dev libffi-dev
  success "System dependencies installed"
}

install_postgres() {
  step "Install PostgreSQL 16"
  if [ ! -f /etc/apt/keyrings/postgresql.gpg ]; then
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | \
      gpg --dearmor -o /etc/apt/keyrings/postgresql.gpg
  fi
  echo "deb [signed-by=/etc/apt/keyrings/postgresql.gpg] \
    https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  apt update -qq
  apt install -y -qq postgresql-16

  systemctl enable postgresql
  systemctl start postgresql

  # Idempotent role/database setup with strict error checking.
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${APP_USER}'" | grep -q 1; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 \
      -c "CREATE ROLE \"${APP_USER}\" WITH LOGIN PASSWORD '${DB_PASS_SQL_ESCAPED}';"
  fi
  sudo -u postgres psql -v ON_ERROR_STOP=1 \
    -c "ALTER ROLE \"${APP_USER}\" WITH LOGIN PASSWORD '${DB_PASS_SQL_ESCAPED}';"

  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${APP_USER}'" | grep -q 1; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 \
      -c "CREATE DATABASE \"${APP_USER}\" OWNER \"${APP_USER}\";"
  fi
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres \
    -c "GRANT ALL PRIVILEGES ON DATABASE \"${APP_USER}\" TO \"${APP_USER}\";"

  # Dynamic memory tuning based on total RAM.
  PG_CONF="/etc/postgresql/16/main/postgresql.conf"
  TOTAL_MEM_MB="$(free -m | awk '/^Mem:/{print $2}')"
  SHARED_MB=$(( TOTAL_MEM_MB / 4 ))
  EFFECTIVE_MB=$(( TOTAL_MEM_MB * 3 / 4 ))
  WORK_MB=$(( TOTAL_MEM_MB / 64 ))
  (( SHARED_MB < 64 )) && SHARED_MB=64
  (( WORK_MB < 4 )) && WORK_MB=4
  (( WORK_MB > 64 )) && WORK_MB=64
  sed -i "s|#shared_buffers = 128MB|shared_buffers = ${SHARED_MB}MB|" "$PG_CONF"
  sed -i "s|#work_mem = 4MB|work_mem = ${WORK_MB}MB|" "$PG_CONF"
  sed -i "s|#maintenance_work_mem = 64MB|maintenance_work_mem = 64MB|" "$PG_CONF"
  sed -i "s|#effective_cache_size = 4GB|effective_cache_size = ${EFFECTIVE_MB}MB|" "$PG_CONF"
  systemctl restart postgresql

  # Verify that password auth really works before continuing.
  PGPASSWORD="${DB_PASS}" psql -h 127.0.0.1 -U "${APP_USER}" -d "${APP_USER}" \
    -c "SELECT 1;" >/dev/null 2>&1 || error "PostgreSQL login check failed for user ${APP_USER}"

  success "PostgreSQL 16 installed, database: ${APP_USER}"
}

install_redis() {
  step "Install Redis 7"
  apt install -y -qq redis-server

  REDIS_CONF="/etc/redis/redis.conf"
  sed -i "s|# requirepass foobared|requirepass ${REDIS_PASS}|" "$REDIS_CONF"
  sed -i "s|# maxmemory <bytes>|maxmemory 256mb|" "$REDIS_CONF"
  sed -i "s|# maxmemory-policy noeviction|maxmemory-policy allkeys-lru|" "$REDIS_CONF"
  # Bind Redis to localhost only.
  sed -i "s|^bind 127.0.0.1 ::1|bind 127.0.0.1|" "$REDIS_CONF"

  systemctl enable redis-server
  systemctl restart redis-server
  success "Redis 7 installed"
}

install_prosody() {
  step "Install Prosody XMPP server"
  apt install -y -qq prosody lua-dbi-postgresql mercurial
  usermod -aG prosody "${APP_USER}" || true

  # Install prosody-modules (community modules) for mod_cloud_notify
  if [ ! -d /usr/lib/prosody-modules ]; then
    hg clone https://hg.prosody.im/prosody-modules /usr/lib/prosody-modules 2>/dev/null \
      || warn "Could not clone prosody-modules; mod_cloud_notify may be unavailable"
  fi

  cp configs/prosody/prosody.cfg.lua /etc/prosody/prosody.cfg.lua
  sed -i "s|XMPP_DOMAIN|${XMPP_DOMAIN}|g" /etc/prosody/prosody.cfg.lua
  # Inject TURN secret if coturn was installed
  if [ -n "${TURN_SECRET:-}" ]; then
    sed -i "s|TURN_SECRET_PLACEHOLDER|${TURN_SECRET}|g" /etc/prosody/prosody.cfg.lua
  fi

  # Tell Prosody where to find community modules
  if ! grep -q "plugin_paths" /etc/prosody/prosody.cfg.lua; then
    sed -i "1i plugin_paths = { \"/usr/lib/prosody-modules\" }" /etc/prosody/prosody.cfg.lua
  fi

  prosodyctl check config 2>/dev/null || true
  systemctl enable prosody
  systemctl restart prosody

  XMPP_ADMIN_JID="${XMPP_ADMIN_USER}@${XMPP_DOMAIN}"
  if prosodyctl register "${XMPP_ADMIN_USER}" "${XMPP_DOMAIN}" "${XMPP_ADMIN_PASS}" >/tmp/conjiweb-prosody-admin.log 2>&1; then
    XMPP_ADMIN_CREATED=1
  else
    if grep -Eiq "exists|already" /tmp/conjiweb-prosody-admin.log; then
      warn "Default account ${XMPP_ADMIN_JID} already exists; keeping existing password"
      XMPP_ADMIN_CREATED=0
    else
      cat /tmp/conjiweb-prosody-admin.log >&2 || true
      error "Failed to create default XMPP admin account: ${XMPP_ADMIN_JID}"
    fi
  fi
  success "Prosody installed, domain: ${XMPP_DOMAIN}"
}

install_coturn() {
  step "Install coturn STUN/TURN server (for Jingle audio/video calls)"
  apt install -y -qq coturn

  TURN_SECRET="$(openssl rand -hex 32)"

  cat > /etc/turnserver.conf <<EOF
# Conjiweb coturn config (auto-generated)
listening-port=3478
tls-listening-port=5349

fingerprint
use-auth-secret
static-auth-secret=${TURN_SECRET}

realm=${DOMAIN}
server-name=turn.${DOMAIN}

# Use Let's Encrypt cert (renewed by certbot)
cert=/etc/letsencrypt/live/${DOMAIN}/fullchain.pem
pkey=/etc/letsencrypt/live/${DOMAIN}/privkey.pem

# Limit relay range - prevents abuse
min-port=49152
max-port=65535

# No anonymous relay
no-multicast-peers
no-cli
no-tlsv1
no-tlsv1_1

# Logging
log-file=/var/log/coturn.log
verbose
EOF

  # Save TURN secret to api/.env so Prosody mod_external_services can use it
  echo "TURN_SECRET=${TURN_SECRET}" >> "${INSTALL_DIR}/api/.env"

  systemctl enable coturn
  systemctl restart coturn
  success "coturn installed (TURN secret saved to api/.env)"
}

install_minio() {
  step "Install MinIO object storage"
  systemctl stop minio 2>/dev/null || true
  pkill -f '/usr/local/bin/minio' 2>/dev/null || true
  sleep 1
  wget -q https://dl.min.io/server/minio/release/linux-amd64/minio -O /tmp/minio.new
  install -m 755 /tmp/minio.new /usr/local/bin/minio
  rm -f /tmp/minio.new

  mkdir -p /data/minio
  chown -R "${MINIO_USER}:${MINIO_USER}" /data/minio

  cat > /etc/systemd/system/minio.service << EOF
[Unit]
Description=MinIO Object Storage
After=network.target

[Service]
User=${MINIO_USER}
Group=${MINIO_USER}
Environment="MINIO_ROOT_USER=${MINIO_ROOT_USER}"
Environment="MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}"
Environment="MINIO_VOLUMES=/data/minio"
ExecStart=/usr/local/bin/minio server /data/minio --console-address "127.0.0.1:9001" --address "127.0.0.1:9000"
Restart=always
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable minio
  systemctl start minio

  sleep 3

  wget -q https://dl.min.io/client/mc/release/linux-amd64/mc \
    -O /usr/local/bin/mc
  chmod +x /usr/local/bin/mc
  /usr/local/bin/mc alias set local http://127.0.0.1:9000 \
    "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}" --quiet 2>/dev/null || true
  /usr/local/bin/mc mb local/conjiweb-files --quiet 2>/dev/null || true
  /usr/local/bin/mc anonymous set none local/conjiweb-files --quiet 2>/dev/null || true

  success "MinIO installed, bucket: conjiweb-files"
}

install_nodejs() {
  step "Install Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
  apt install -y -qq nodejs
  success "Node.js $(node --version) installed"
}

deploy_api() {
  step "Deploy FastAPI backend"
  mkdir -p "${INSTALL_DIR}"
  rm -rf "${INSTALL_DIR}/api"
  cp -r "${SRC_DIR}/apps/api" "${INSTALL_DIR}/api"
  chown -R "${APP_USER}:${APP_USER}" "${INSTALL_DIR}/api"

  cd "${INSTALL_DIR}/api"
  python3.11 -m venv .venv
  .venv/bin/pip install -q --upgrade pip
  .venv/bin/pip install -q -r requirements.txt

  # Generate VAPID keypair for Web Push (PWA notifications)
  if [ -z "${VAPID_PRIVATE_KEY:-}" ]; then
    VAPID_PEM_FILE="$(mktemp)"
    openssl ecparam -name prime256v1 -genkey -noout -out "$VAPID_PEM_FILE" 2>/dev/null
    VAPID_PRIVATE_KEY="$(openssl pkey -in "$VAPID_PEM_FILE" -outform DER 2>/dev/null \
        | tail -c 32 | base64 | tr '+/' '-_' | tr -d '=' | tr -d '\n')"
    VAPID_PUBLIC_KEY="$(openssl ec -in "$VAPID_PEM_FILE" -pubout -outform DER 2>/dev/null \
        | tail -c 65 | base64 | tr '+/' '-_' | tr -d '=' | tr -d '\n')"
    rm -f "$VAPID_PEM_FILE"
  fi
  PUSH_SHARED_SECRET="${PUSH_SHARED_SECRET:-$(openssl rand -hex 24)}"

  cat > "${INSTALL_DIR}/api/.env" << EOF
DATABASE_URL=postgresql+asyncpg://${APP_USER}:${DB_PASS_URLENCODED}@127.0.0.1:5432/${APP_USER}
REDIS_URL=redis://:${REDIS_PASS}@127.0.0.1:6379/0
MINIO_ENDPOINT=127.0.0.1:9000
MINIO_ACCESS_KEY=${MINIO_ROOT_USER}
MINIO_SECRET_KEY=${MINIO_ROOT_PASSWORD}
MINIO_BUCKET=conjiweb-files
MINIO_SECURE=false
SECRET_KEY=${SECRET_KEY}
CORS_ORIGINS=["https://${DOMAIN}"]
XMPP_DOMAIN=${XMPP_DOMAIN}
XMPP_REGISTRATION_ENABLED=true
PUBLIC_DOMAIN=${PUBLIC_DOMAIN}
ADMIN_USER=${ADMIN_USER}
ADMIN_PASS=${ADMIN_PASS}
AI_API_KEY=${AI_API_KEY}
AI_BASE_URL=${AI_BASE_URL}
AI_MODEL=${AI_MODEL}
ALERT_EMAIL=${ALERT_EMAIL}
DB_POOL_SIZE=${DB_POOL_SIZE}
DB_MAX_OVERFLOW=${DB_MAX_OVERFLOW}
DB_POOL_TIMEOUT=${DB_POOL_TIMEOUT}
DB_POOL_RECYCLE=${DB_POOL_RECYCLE}
VAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY}
VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY}
VAPID_EMAIL=admin@${DOMAIN}
PUSH_SHARED_SECRET=${PUSH_SHARED_SECRET}
EOF
  chmod 600 "${INSTALL_DIR}/api/.env"
  chown "${APP_USER}:${APP_USER}" "${INSTALL_DIR}/api/.env"

  # Alembic uses alembic.ini sqlalchemy.url (not app .env), keep them in sync.
  sed -i "s|^sqlalchemy.url = .*|sqlalchemy.url = postgresql+asyncpg://${APP_USER}:${DB_PASS_URLENCODED}@127.0.0.1:5432/${APP_USER}|" \
    "${INSTALL_DIR}/api/alembic.ini"

  # Run database migrations.
  cd "${INSTALL_DIR}/api"
  DB_HAS_ACCOUNTS="$(
    PGPASSWORD="${DB_PASS}" psql -h 127.0.0.1 -U "${APP_USER}" -d "${APP_USER}" -tAc \
      "SELECT CASE WHEN to_regclass('public.accounts') IS NULL THEN '0' ELSE '1' END;" 2>/dev/null || echo "0"
  )"
  DB_HAS_ALEMBIC="$(
    PGPASSWORD="${DB_PASS}" psql -h 127.0.0.1 -U "${APP_USER}" -d "${APP_USER}" -tAc \
      "SELECT CASE WHEN to_regclass('public.alembic_version') IS NULL THEN '0' ELSE '1' END;" 2>/dev/null || echo "0"
  )"

  if [[ "${DB_HAS_ACCOUNTS}" = "1" && "${DB_HAS_ALEMBIC}" = "0" ]]; then
    warn "Detected existing schema without alembic version table, stamping to head..."
    .venv/bin/alembic stamp head
  fi
  .venv/bin/alembic upgrade head

  NPROC="$(nproc || echo 1)"
  UVICORN_WORKERS=$(( NPROC * 2 + 1 ))
  (( UVICORN_WORKERS > 8 )) && UVICORN_WORKERS=8
  (( UVICORN_WORKERS < 2 )) && UVICORN_WORKERS=2
  cat > /etc/systemd/system/conjiweb-api.service << EOF
[Unit]
Description=Conjiweb FastAPI Backend
After=network.target postgresql.service redis.service
Requires=postgresql.service

[Service]
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${INSTALL_DIR}/api
EnvironmentFile=${INSTALL_DIR}/api/.env
ExecStart=${INSTALL_DIR}/api/.venv/bin/uvicorn app.main:app \\
    --host 127.0.0.1 \\
    --port 8000 \\
    --workers ${UVICORN_WORKERS} \\
    --log-level info
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable conjiweb-api
  systemctl start conjiweb-api
  sleep 2

  cd "${SRC_DIR}"
  success "FastAPI backend deployed, listening on 127.0.0.1:8000"
}

deploy_frontend() {
  step "Build frontend (React + Vite)"
  rm -rf "${INSTALL_DIR}/web"
  cp -r "${SRC_DIR}/apps/web" "${INSTALL_DIR}/web"
  cd "${INSTALL_DIR}/web"

  cat > .env.production << EOF
VITE_API_URL=https://${DOMAIN}/api
VITE_XMPP_WS_URL=wss://${DOMAIN}/xmpp-websocket
EOF

  if [[ -f package-lock.json ]]; then
    npm ci --silent
  else
    warn "package-lock.json not found, using npm install instead of npm ci"
    npm install --silent --no-audit --no-fund
  fi
  npm run build

  FRONTEND_DIST="${INSTALL_DIR}/web/dist"
  cd "${SRC_DIR}"
  success "Frontend build completed, output: ${FRONTEND_DIST}"
}

install_nginx() {
  step "Install and configure Nginx"
  apt install -y -qq nginx

  # Temporary HTTP config for certbot validation.
  cat > /etc/nginx/sites-available/conjiweb << EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    root ${INSTALL_DIR}/web/dist;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}
EOF

  ln -sf /etc/nginx/sites-available/conjiweb /etc/nginx/sites-enabled/conjiweb
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl restart nginx
  success "Nginx temporary config completed"
}

setup_ssl() {
  step "Issue Let's Encrypt SSL certificate"
  apt install -y -qq certbot python3-certbot-nginx

  local cert_dir="/etc/letsencrypt/live/${DOMAIN}"
  local cert_fullchain="${cert_dir}/fullchain.pem"
  local cert_privkey="${cert_dir}/privkey.pem"
  local has_usable_cert=0
  if [[ -f "$cert_fullchain" && -f "$cert_privkey" ]]; then
    if openssl x509 -checkend 86400 -noout -in "$cert_fullchain" >/dev/null 2>&1; then
      has_usable_cert=1
      info "Usable certificate detected, skipping re-issuance"
    fi
  fi

  if [[ "$has_usable_cert" -eq 0 ]]; then
    certbot certonly --nginx \
      -d "${DOMAIN}" \
      --email "${EMAIL}" \
      --agree-tos \
      --non-interactive
    success "SSL certificate issued successfully"
  fi

  cp configs/nginx/conjiweb.conf /etc/nginx/sites-available/conjiweb
  sed -i "s|DOMAIN|${DOMAIN}|g" /etc/nginx/sites-available/conjiweb
  sed -i "s|INSTALL_DIR|${INSTALL_DIR}|g" /etc/nginx/sites-available/conjiweb
  cat > /etc/nginx/conf.d/conjiweb-rate-limit.conf << 'EOF'
limit_req_zone $binary_remote_addr zone=api_auth:10m rate=30r/m;
EOF

  nginx -t && systemctl reload nginx
  success "Nginx HTTPS configuration completed"

  systemctl enable certbot.timer
  systemctl start certbot.timer
}

setup_firewall() {
  detect_ssh_ports() {
    local ports=""
    if command -v ss >/dev/null 2>&1; then
      ports="$(ss -H -tnlp 2>/dev/null | awk '/sshd/ {split($4,a,":"); p=a[length(a)]; if (p ~ /^[0-9]+$/) print p}' | sort -n | uniq | paste -sd' ' -)"
    fi
    if [[ -z "$ports" ]]; then
      ports="$(awk '/^[[:space:]]*Port[[:space:]]+[0-9]+/ {print $2}' /etc/ssh/sshd_config 2>/dev/null | sort -n | uniq | paste -sd' ' -)"
    fi
    if [[ -z "$ports" ]] && compgen -G "/etc/ssh/sshd_config.d/*.conf" >/dev/null; then
      ports="$(awk '/^[[:space:]]*Port[[:space:]]+[0-9]+/ {print $2}' /etc/ssh/sshd_config.d/*.conf 2>/dev/null | sort -n | uniq | paste -sd' ' -)"
    fi
    if [[ -z "$ports" ]]; then
      ports="22"
    fi
    echo "$ports"
  }

  validate_port() {
    local p="$1"
    [[ "$p" =~ ^[0-9]+$ ]] || return 1
    (( p >= 1 && p <= 65535 ))
  }

  prompt_yes_no() {
    local prompt="$1"
    local default_no="${2:-1}"
    local reply=""
    if [[ -r /dev/tty ]]; then
      if [[ "$default_no" -eq 1 ]]; then
        read -r -p "${prompt} [yes/NO]: " reply < /dev/tty
      else
        read -r -p "${prompt} [YES/no]: " reply < /dev/tty
      fi
    elif [[ -t 0 ]]; then
      if [[ "$default_no" -eq 1 ]]; then
        read -r -p "${prompt} [yes/NO]: " reply
      else
        read -r -p "${prompt} [YES/no]: " reply
      fi
    else
      warn "Non-interactive session detected. Defaulting to no: ${prompt}"
      return 1
    fi
    reply="${reply// /}"
    [[ "${reply,,}" == "yes" ]]
  }

  prompt_input() {
    local prompt="$1"
    local reply=""
    if [[ -r /dev/tty ]]; then
      read -r -p "${prompt}" reply < /dev/tty
    elif [[ -t 0 ]]; then
      read -r -p "${prompt}" reply
    else
      return 1
    fi
    echo "$reply"
  }

  apply_sshd_dropin_and_reload() {
    mkdir -p /etc/ssh/sshd_config.d
    cat > /etc/ssh/sshd_config.d/99-conjiweb-auth.conf <<'EOF'
PasswordAuthentication yes
PubkeyAuthentication yes
EOF

    if command -v sshd >/dev/null 2>&1; then
      sshd -t
    elif [[ -x /usr/sbin/sshd ]]; then
      /usr/sbin/sshd -t
    else
      error "sshd binary not found, cannot validate SSH config"
    fi

    systemctl reload ssh 2>/dev/null || \
    systemctl reload sshd 2>/dev/null || \
    systemctl restart ssh 2>/dev/null || \
    systemctl restart sshd 2>/dev/null || \
    error "failed to reload ssh service"
  }

  apply_sshd_port() {
    local new_port="$1"
    mkdir -p /etc/ssh/sshd_config.d
    cat > /etc/ssh/sshd_config.d/99-conjiweb-port.conf <<EOF
Port ${new_port}
EOF
    apply_sshd_dropin_and_reload
  }

  detect_or_create_local_public_key() {
    local ssh_dir="${HOME}/.ssh"
    local priv=""
    local pub=""
    mkdir -p "$ssh_dir"
    chmod 700 "$ssh_dir"

    if [[ -n "${SSH_AUTH_SOCK:-}" ]] && command -v ssh-add >/dev/null 2>&1; then
      local agent_key
      agent_key="$(ssh-add -L 2>/dev/null | awk '/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-)/ {print; exit}' || true)"
      if [[ -n "$agent_key" ]]; then
        echo "$agent_key"
        return 0
      fi
    fi

    for priv in "$ssh_dir/id_ed25519" "$ssh_dir/id_ecdsa" "$ssh_dir/id_rsa"; do
      if [[ -f "$priv" ]]; then
        pub="${priv}.pub"
        if [[ ! -f "$pub" ]]; then
          ssh-keygen -y -f "$priv" > "$pub"
          chmod 644 "$pub"
        fi
        cat "$pub"
        return 0
      fi
    done

    info "No existing SSH private key detected. Creating ${ssh_dir}/id_ed25519 automatically"
    ssh-keygen -t ed25519 -f "${ssh_dir}/id_ed25519" -N "" -C "conjiweb@$(hostname)-$(date +%F)" >/dev/null
    cat "${ssh_dir}/id_ed25519.pub"
  }

  add_key_to_authorized_keys() {
    local key_line="$1"
    local auth_file="${HOME}/.ssh/authorized_keys"
    mkdir -p "${HOME}/.ssh"
    chmod 700 "${HOME}/.ssh"
    touch "$auth_file"
    chmod 600 "$auth_file"
    if ! grep -qxF "$key_line" "$auth_file" 2>/dev/null; then
      echo "$key_line" >> "$auth_file"
    fi
  }

  step "Configure firewall (ufw)"
  local ssh_ports_raw
  ssh_ports_raw="$(detect_ssh_ports)"
  if [[ -z "${SSH_PORT:-}" ]]; then
    SSH_PORT="$ssh_ports_raw"
  fi
  SSH_PORT="${SSH_PORT//,/ }"
  SSH_PORT="$(echo "$SSH_PORT" | tr -s '[:space:]' ' ' | sed 's/^ //; s/ $//')"
  [[ -n "$SSH_PORT" ]] || error "Unable to determine SSH port. Please provide --ssh-port manually."
  local p
  for p in $SSH_PORT; do
    validate_port "$p" || error "Invalid SSH port: ${p}"
  done
  info "Auto-detected SSH port(s): ${SSH_PORT}"

  local has_port_22=0
  for p in $SSH_PORT; do
    if [[ "$p" == "22" ]]; then
      has_port_22=1
      break
    fi
  done
  if [[ "$has_port_22" -eq 1 ]] && prompt_yes_no "Detected SSH port 22. Do you want to change the login port?"; then
    local new_ssh_port=""
    while true; do
      new_ssh_port="$(prompt_input "Enter the new SSH port: " || true)"
      [[ -n "$new_ssh_port" ]] || { warn "No input detected. Please try again."; continue; }
      new_ssh_port="${new_ssh_port// /}"
      validate_port "$new_ssh_port" || { warn "Port is invalid. Please try again."; continue; }
      [[ "$new_ssh_port" != "22" ]] || { warn "New port cannot be 22. Please choose another one."; continue; }
      break
    done
    apply_sshd_port "$new_ssh_port"
    SSH_PORT="$new_ssh_port"
    info "SSH login port switched to: ${SSH_PORT}"
  fi

  if prompt_yes_no "Do you want to auto-configure SSH key login (while keeping password login enabled)?"; then
    local detected_pub_key=""
    detected_pub_key="$(detect_or_create_local_public_key)"
    [[ -n "$detected_pub_key" ]] || error "Unable to obtain a usable public key"
    add_key_to_authorized_keys "$detected_pub_key"
    apply_sshd_dropin_and_reload
    success "SSH key login configured. Password login remains enabled."
  fi

  if ! prompt_yes_no "Confirm applying UFW with detected SSH port(s) and allowing only 80/443/5222/5269?"; then
    warn "Firewall changes canceled (did not enter yes)."
    return 0
  fi

  ufw --force reset
  ufw default deny incoming
  ufw default allow outgoing
  for p in $SSH_PORT; do
    ufw allow "${p}/tcp"
  done
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow 5222/tcp   # XMPP TCP
  ufw allow 5269/tcp
  ufw allow 3478/tcp comment 'coturn STUN/TURN'
  ufw allow 3478/udp comment 'coturn STUN/TURN'
  ufw allow 5349/tcp comment 'coturn TLS'
  ufw allow 49152:65535/udp comment 'coturn relay'   # XMPP server-to-server
  if prompt_yes_no "Disable ICMP ping (stricter security, but harder network diagnostics)?"; then
    ufw deny in from any to any proto icmp || warn "ICMP rule not applied by ufw, skipping"
  fi
  ufw --force enable
  success "Firewall configuration completed"
}

setup_fail2ban() {
  step "Configure fail2ban (anti-bruteforce)"
  cat > /etc/fail2ban/filter.d/conjiweb-api.conf << 'EOF'
[Definition]
failregex = ^<HOST> - .* "POST /api/auth/(admin/login|register) HTTP.*" (4[0-9][0-9]) .*
ignoreregex =
EOF

  cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port    = ssh
logpath = %(sshd_log)s

[nginx-http-auth]
enabled = true

[conjiweb-api]
enabled = true
port = 443
filter = conjiweb-api
logpath = /var/log/nginx/access.log
maxretry = 5
bantime = 3600
EOF
  systemctl enable fail2ban
  systemctl restart fail2ban
  success "fail2ban configuration completed"
}

setup_backup() {
  step "Configure automated backups"
  mkdir -p /root/backups
  chmod 700 /root/backups
  if [[ -n "${BACKUP_REMOTE}" ]] && ! command -v rclone >/dev/null 2>&1; then
    info "BACKUP_REMOTE is set, installing rclone for offsite sync"
    apt install -y -qq rclone
  fi

  cat > /usr/local/bin/conjiweb-backup.sh << BACKUP
#!/bin/bash
set -euo pipefail
BACKUP_DIR="/root/backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_REMOTE="${BACKUP_REMOTE}"
DB_NAME="${APP_USER}"
mkdir -p "$BACKUP_DIR"

# Backup PostgreSQL
sudo -u postgres pg_dump "$DB_NAME" | gzip > "${BACKUP_DIR}/db_${DATE}.sql.gz"
if ! gzip -t "${BACKUP_DIR}/db_${DATE}.sql.gz"; then
  echo "backup verification failed: db_${DATE}.sql.gz" >&2
  exit 1
fi

# Backup MinIO data
tar czf "${BACKUP_DIR}/minio_${DATE}.tar.gz" /data/minio/ 2>/dev/null || true

# Retain backups for 7 days
find "$BACKUP_DIR" -name "*.gz" -mtime +7 -delete

if [[ -n "$BACKUP_REMOTE" ]] && command -v rclone >/dev/null 2>&1; then
  rclone copy "$BACKUP_DIR/" "$BACKUP_REMOTE" --max-age 7d --transfers 2 --checkers 4 || true
fi

echo "backup completed: ${DATE}"
BACKUP
  chmod +x /usr/local/bin/conjiweb-backup.sh

  # Run backup daily at 03:00
  echo "0 3 * * * root /usr/local/bin/conjiweb-backup.sh >> /var/log/conjiweb-backup.log 2>&1" \
    > /etc/cron.d/conjiweb-backup

  success "Backup configured (daily at 03:00)"
}

setup_logrotate_and_journald() {
  step "Configure log rotation and journald limits"
  cp "${SRC_DIR}/configs/logrotate/conjiweb" /etc/logrotate.d/conjiweb

  mkdir -p /etc/systemd/journald.conf.d
  cat > /etc/systemd/journald.conf.d/conjiweb.conf << 'EOF'
[Journal]
SystemMaxUse=500M
EOF
  systemctl restart systemd-journald || true
  success "Log rotation configuration completed"
}

setup_monitoring_alert() {
  step "Configure lightweight service monitoring and self-heal script"
  cat > /usr/local/bin/conjiweb-alert.sh << 'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ -f /opt/conjiweb-src/.env ]]; then
  # shellcheck disable=SC1091
  source /opt/conjiweb-src/.env
fi
services=(postgresql redis-server prosody conjiweb-api nginx)
ALERT_EMAIL="${ALERT_EMAIL:-}"
for svc in "${services[@]}"; do
  if ! systemctl is-active --quiet "$svc"; then
    msg="$(date '+%F %T') WARN service down: $svc"
    echo "$msg" >> /var/log/conjiweb-alert.log
    systemctl restart "$svc" || true
    if [[ -n "$ALERT_EMAIL" ]] && command -v mail >/dev/null 2>&1; then
      echo "$msg" | mail -s "Conjiweb service alert" "$ALERT_EMAIL" || true
    fi
  fi
done

for mount in / /data; do
  if ! df -P "$mount" >/dev/null 2>&1; then
    continue
  fi
  use_pct="$(df -P "$mount" | awk 'NR==2 {gsub(/%/, "", $5); print $5}')"
  if [[ -n "$use_pct" ]] && (( use_pct >= 90 )); then
    msg="$(date '+%F %T') WARN disk usage high: $mount ${use_pct}%"
    echo "$msg" >> /var/log/conjiweb-alert.log
    if [[ -n "$ALERT_EMAIL" ]] && command -v mail >/dev/null 2>&1; then
      echo "$msg" | mail -s "Conjiweb disk alert" "$ALERT_EMAIL" || true
    fi
  fi
done
EOF
  chmod +x /usr/local/bin/conjiweb-alert.sh
  echo "*/5 * * * * root /usr/local/bin/conjiweb-alert.sh" > /etc/cron.d/conjiweb-alert
  success "Monitoring alert script configured (every 5 minutes)"
}

setup_quick_check() {
  cat > /usr/local/bin/conjiweb-check << 'CHECK'
#!/usr/bin/env bash
set -euo pipefail

echo "=== Conjiweb 30s Check ==="
for svc in postgresql redis-server prosody minio conjiweb-api nginx; do
  state=$(systemctl is-active "$svc" 2>/dev/null || true)
  printf "%-16s %s\n" "$svc" "${state:-unknown}"
done

echo ""
echo "--- HTTP ---"
curl -k -I --max-time 8 "https://$1" 2>/dev/null | head -n 1 || echo "https://$1 FAIL"
curl -k -I --max-time 8 "https://$1/api/docs" 2>/dev/null | head -n 1 || echo "https://$1/api/docs FAIL"
CHECK
  chmod +x /usr/local/bin/conjiweb-check
}

write_secrets_file() {
  local secrets_file="/root/conjiweb-secrets.txt"
  cat > "${secrets_file}" <<EOF
Conjiweb Secrets
Generated: $(date '+%F %T')
Domain: ${DOMAIN}

DATABASE_PASSWORD=${DB_PASS}
REDIS_PASSWORD=${REDIS_PASS}
MINIO_ROOT_USER=${MINIO_ROOT_USER}
MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}
SECRET_KEY=${SECRET_KEY}
XMPP_ADMIN_JID=${XMPP_ADMIN_JID:-${XMPP_ADMIN_USER}@${XMPP_DOMAIN}}
XMPP_ADMIN_PASS=${XMPP_ADMIN_PASS}
ADMIN_USER=${ADMIN_USER}
ADMIN_PASS=${ADMIN_PASS}
EOF
  chmod 600 "${secrets_file}"
}

print_summary() {
  echo ""
  echo -e "${GREEN}============================================================${NC}"
  echo -e "${GREEN}                  Conjiweb Install Completed                ${NC}"
  echo -e "${GREEN}============================================================${NC}"
  echo ""
  echo -e "  ${CYAN}Web URL:${NC}        https://${DOMAIN}"
  echo -e "  ${CYAN}API Docs:${NC}       https://${DOMAIN}/api/docs"
  echo -e "  ${CYAN}XMPP Domain:${NC}    ${XMPP_DOMAIN}"
  echo -e "  ${CYAN}WebSocket:${NC}      wss://${DOMAIN}/xmpp-websocket"
  echo ""
  echo -e "  ${YELLOW}Default XMPP admin account:${NC}"
  echo -e "  JID: ${XMPP_ADMIN_JID:-${XMPP_ADMIN_USER}@${XMPP_DOMAIN}}"
  if [[ "${XMPP_ADMIN_CREATED}" = "1" ]]; then
    echo -e "  Password: ${XMPP_ADMIN_PASS}"
  else
    echo -e "  Password: (account already existed, existing password kept)"
  fi
  echo ""
  echo -e "  ${YELLOW}Useful commands:${NC}"
  echo -e "  systemctl status conjiweb-api   # Check API status"
  echo -e "  journalctl -u conjiweb-api -f   # Follow API logs"
  echo -e "  systemctl status prosody        # Check XMPP status"
  echo -e "  systemctl status nginx          # Check Nginx status"
  echo -e "  conjiweb-backup.sh              # Run backup now"
  echo -e "  conjiweb-check ${DOMAIN}        # Run 30-second checks"
  echo ""
  echo -e "  Secrets file: /root/conjiweb-secrets.txt (chmod 600)"
  echo ""
  echo -e "  ${RED}Store these generated passwords safely:${NC}"
  echo -e "  Database: ${DB_PASS}"
  echo -e "  Redis: ${REDIS_PASS}"
  echo -e "  MinIO: ${MINIO_ROOT_PASSWORD}"
  echo ""
}

main() {
  SRC_DIR="$(pwd -P)"
  [[ -d "${SRC_DIR}/apps/api" ]] || error "Missing source directory: ${SRC_DIR}/apps/api"
  [[ -d "${SRC_DIR}/apps/web" ]] || error "Missing source directory: ${SRC_DIR}/apps/web"

  echo -e "${CYAN}"
  echo -e "${CYAN}Conjiweb Installer${NC}"
  echo ""




  echo -e "${NC}"

  echo ""

  load_config
  setup_quick_check
  check_system
  setup_apt_mirror
  upgrade_system_packages
  install_deps
  ensure_service_users
  install_postgres
  install_redis
  install_prosody
  install_coturn
  install_minio
  install_nodejs
  deploy_api
  deploy_frontend
  install_nginx
  setup_ssl
  setup_firewall
  setup_fail2ban
  setup_backup
  setup_logrotate_and_journald
  setup_monitoring_alert
  write_secrets_file
  print_summary
}

parse_bootstrap_args "$@"
bootstrap_if_needed
main
