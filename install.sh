#!/usr/bin/env bash
# =============================================================================
#  Conjiweb 鈥?Install Script
#  Target: Debian/Linux VPS (root)
#  Usage:  bash install.sh --repo <repo_url> --domain <domain> --email <email>
# =============================================================================
set -euo pipefail

# 鈹€鈹€ 棰滆壊杈撳嚭 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERR]${NC}  $*"; exit 1; }
step()    { echo -e "\n${CYAN}鈹佲攣鈹?$* 鈹佲攣鈹?{NC}"; }

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

# 鈹€鈹€ 閰嶇疆鍙橀噺锛堝畨瑁呭墠鑷姩璇诲彇 .env锛?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
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
    read -rp "璇疯緭鍏ョ湡瀹炲煙鍚嶏紙渚嬪 chat.yourdomain.com锛? " DOMAIN
    DOMAIN="${DOMAIN// /}"
  fi
  if is_placeholder_email "$EMAIL" && [[ -t 0 ]]; then
    read -rp "璇疯緭鍏ラ偖绠憋紙鐢ㄤ簬 SSL 璇佷功閫氱煡锛? " EMAIL
    EMAIL="${EMAIL// /}"
  fi
  is_placeholder_domain "$DOMAIN" && { bootstrap_usage; error "--domain 缂哄け鎴栦粛鏄ず渚嬪€?; }
  is_placeholder_email "$EMAIL" && { bootstrap_usage; error "--email 缂哄け鎴栦粛鏄ず渚嬪€?; }
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

# 鈹€鈹€ 璇诲彇閰嶇疆鏂囦欢 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
load_config() {
  if [ ! -f ".env" ]; then
    error ".env 鏂囦欢涓嶅瓨鍦紝璇峰厛澶嶅埗: cp .env.example .env 骞跺～鍐欓厤缃?
  fi
  # Normalize CRLF to LF to avoid hidden '\r' in secrets.
  sed -i 's/\r$//' .env
  # shellcheck disable=SC1091
  set -a; source .env; set +a

  DOMAIN="${DOMAIN:-}"
  EMAIL="${EMAIL:-}"
  DB_PASS="${DB_PASS:-$(openssl rand -hex 16)}"
  REDIS_PASS="${REDIS_PASS:-$(openssl rand -hex 16)}"
  MINIO_ROOT_USER="${MINIO_ROOT_USER:-minioadmin}"
  MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-$(openssl rand -hex 16)}"
  SECRET_KEY="${SECRET_KEY:-$(openssl rand -hex 32)}"
  XMPP_DOMAIN="${XMPP_DOMAIN:-localhost}"
  XMPP_ADMIN_PASS="${XMPP_ADMIN_PASS:-$(openssl rand -hex 12)}"

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

  DB_PASS_SQL_ESCAPED="${DB_PASS//\'/\'\'}"
  DB_PASS_URLENCODED="$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "${DB_PASS}")"

  if is_placeholder_domain "$DOMAIN" && [[ -t 0 ]]; then
    read -rp "璇疯緭鍏ョ湡瀹炲煙鍚嶏紙渚嬪 chat.yourdomain.com锛? " DOMAIN
    DOMAIN="${DOMAIN// /}"
  fi
  if is_placeholder_email "$EMAIL" && [[ -t 0 ]]; then
    read -rp "璇疯緭鍏ラ偖绠憋紙鐢ㄤ簬 SSL 璇佷功閫氱煡锛? " EMAIL
    EMAIL="${EMAIL// /}"
  fi
  is_placeholder_domain "$DOMAIN" && error "璇峰湪 .env 涓缃湡瀹?DOMAIN锛堝綋鍓? ${DOMAIN:-绌簘)"
  is_placeholder_email "$EMAIL" && error "璇峰湪 .env 涓缃湡瀹?EMAIL锛堝綋鍓? ${EMAIL:-绌簘)"

  # 鏇存柊 .env 鍐欏洖闅忔満鐢熸垚鐨勫€?  sed -i "s|^DB_PASS=.*|DB_PASS=${DB_PASS}|" .env
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
  chmod 600 .env
}

# 鈹€鈹€ 1. 绯荤粺妫€鏌?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
check_system() {
  step "绯荤粺妫€鏌?
  [ "$(id -u)" -eq 0 ] || error "璇蜂娇鐢?root 鐢ㄦ埛杩愯"

  OS=$(grep -oP '(?<=^ID=).+' /etc/os-release | tr -d '"')
  VER=$(grep -oP '(?<=^VERSION_ID=).+' /etc/os-release | tr -d '"')
  [ "$OS" = "debian" ] && [ "$VER" = "12" ] || warn "寤鸿鍦?Debian 12 涓婅繍琛岋紝褰撳墠: $OS $VER"

  MEM=$(free -m | awk '/^Mem:/{print $2}')
  info "鍐呭瓨: ${MEM}MB"
  [ "$MEM" -lt 1500 ] && warn "鍐呭瓨涓嶈冻 1.5GB锛屽彲鑳藉奖鍝嶇ǔ瀹氭€?

  success "绯荤粺妫€鏌ラ€氳繃"
}

# 鈹€鈹€ 2. 鎹㈡棩鏈?apt 婧愶紙鐞嗗寲瀛︾爺绌舵墍闀滃儚锛岄€熷害蹇級 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
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

# 鈹€鈹€ 3. 鑷姩鍗囩骇绯荤粺鍖?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
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

# 鈹€鈹€ 3. 瀹夎绯荤粺渚濊禆 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
install_deps() {
  step "瀹夎绯荤粺渚濊禆"
  apt install -y -qq \
    curl wget git unzip build-essential \
    ca-certificates gnupg lsb-release \
    openssl htop vim ufw fail2ban \
    python3.11 python3.11-venv python3-pip \
    libpq-dev libssl-dev libffi-dev
  success "绯荤粺渚濊禆瀹夎瀹屾垚"
}

# 鈹€鈹€ 4. 瀹夎 PostgreSQL 16 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
install_postgres() {
  step "瀹夎 PostgreSQL 16"
  # 瀹樻柟鏃ユ湰闀滃儚
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

  success "PostgreSQL 16 瀹夎瀹屾垚锛屾暟鎹簱: ${APP_USER}"
}

# 鈹€鈹€ 5. 瀹夎 Redis 7 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
install_redis() {
  step "瀹夎 Redis 7"
  apt install -y -qq redis-server

  REDIS_CONF="/etc/redis/redis.conf"
  sed -i "s|# requirepass foobared|requirepass ${REDIS_PASS}|" "$REDIS_CONF"
  sed -i "s|# maxmemory <bytes>|maxmemory 256mb|" "$REDIS_CONF"
  sed -i "s|# maxmemory-policy noeviction|maxmemory-policy allkeys-lru|" "$REDIS_CONF"
  # 缁戝畾浠呮湰鍦?  sed -i "s|^bind 127.0.0.1 ::1|bind 127.0.0.1|" "$REDIS_CONF"

  systemctl enable redis-server
  systemctl restart redis-server
  success "Redis 7 瀹夎瀹屾垚"
}

# 鈹€鈹€ 6. 瀹夎 Prosody XMPP 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
install_prosody() {
  step "瀹夎 Prosody XMPP 鏈嶅姟鍣?
  apt install -y -qq prosody lua-dbi-postgresql

  # 鍐欏叆閰嶇疆
  cp configs/prosody/prosody.cfg.lua /etc/prosody/prosody.cfg.lua
  # 鏇挎崲鍩熷悕
  sed -i "s|XMPP_DOMAIN|${XMPP_DOMAIN}|g" /etc/prosody/prosody.cfg.lua

  prosodyctl check config 2>/dev/null || true
  systemctl enable prosody
  systemctl restart prosody

  XMPP_ADMIN_JID="${XMPP_ADMIN_USER}@${XMPP_DOMAIN}"
  if prosodyctl register "${XMPP_ADMIN_USER}" "${XMPP_DOMAIN}" "${XMPP_ADMIN_PASS}" >/tmp/conjiweb-prosody-admin.log 2>&1; then
    XMPP_ADMIN_CREATED=1
  else
    if grep -Eiq "exists|already" /tmp/conjiweb-prosody-admin.log; then
      warn "榛樿璐﹀彿 ${XMPP_ADMIN_JID} 宸插瓨鍦紝淇濈暀鐜版湁瀵嗙爜"
      XMPP_ADMIN_CREATED=0
    else
      cat /tmp/conjiweb-prosody-admin.log >&2 || true
      error "鍒涘缓榛樿 XMPP 绠＄悊鍛樿处鍙峰け璐? ${XMPP_ADMIN_JID}"
    fi
  fi
  success "Prosody 瀹夎瀹屾垚锛屽煙鍚? ${XMPP_DOMAIN}"
}

# 鈹€鈹€ 7. 瀹夎 MinIO 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
install_minio() {
  step "瀹夎 MinIO 瀵硅薄瀛樺偍"
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

  # 绛夊緟 MinIO 鍚姩
  sleep 3

  # 鍒涘缓榛樿 bucket
  wget -q https://dl.min.io/client/mc/release/linux-amd64/mc \
    -O /usr/local/bin/mc
  chmod +x /usr/local/bin/mc
  /usr/local/bin/mc alias set local http://127.0.0.1:9000 \
    "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}" --quiet 2>/dev/null || true
  /usr/local/bin/mc mb local/conjiweb-files --quiet 2>/dev/null || true
  /usr/local/bin/mc anonymous set none local/conjiweb-files --quiet 2>/dev/null || true

  success "MinIO 瀹夎瀹屾垚锛孊ucket: conjiweb-files"
}

# 鈹€鈹€ 8. 瀹夎 Node.js 20 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
install_nodejs() {
  step "瀹夎 Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
  apt install -y -qq nodejs
  success "Node.js $(node --version) 瀹夎瀹屾垚"
}

# 鈹€鈹€ 9. 閮ㄧ讲鍚庣 API 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
deploy_api() {
  step "閮ㄧ讲 FastAPI 鍚庣"
  mkdir -p "${INSTALL_DIR}"
  rm -rf "${INSTALL_DIR}/api"
  cp -r "${SRC_DIR}/apps/api" "${INSTALL_DIR}/api"
  chown -R "${APP_USER}:${APP_USER}" "${INSTALL_DIR}/api"

  cd "${INSTALL_DIR}/api"
  python3.11 -m venv .venv
  .venv/bin/pip install -q --upgrade pip
  .venv/bin/pip install -q -r requirements.txt

  # 鐢熸垚 API .env
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
EOF
  chmod 600 "${INSTALL_DIR}/api/.env"
  chown "${APP_USER}:${APP_USER}" "${INSTALL_DIR}/api/.env"

  # Alembic uses alembic.ini sqlalchemy.url (not app .env), keep them in sync.
  sed -i "s|^sqlalchemy.url = .*|sqlalchemy.url = postgresql+asyncpg://${APP_USER}:${DB_PASS_URLENCODED}@127.0.0.1:5432/${APP_USER}|" \
    "${INSTALL_DIR}/api/alembic.ini"

  # 杩愯鏁版嵁搴撹縼绉?  cd "${INSTALL_DIR}/api"
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

  # 鍒涘缓 systemd 鏈嶅姟
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
  success "FastAPI 鍚庣閮ㄧ讲瀹屾垚锛岀洃鍚?127.0.0.1:8000"
}

# 鈹€鈹€ 10. 鏋勫缓骞堕儴缃插墠绔?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
deploy_frontend() {
  step "鏋勫缓鍓嶇锛圧eact + Vite锛?
  rm -rf "${INSTALL_DIR}/web"
  cp -r "${SRC_DIR}/apps/web" "${INSTALL_DIR}/web"
  cd "${INSTALL_DIR}/web"

  # 鍐欏叆鍓嶇鐜鍙橀噺
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
  success "鍓嶇鏋勫缓瀹屾垚锛岃緭鍑虹洰褰? ${FRONTEND_DIST}"
}

# 鈹€鈹€ 11. 瀹夎閰嶇疆 Nginx 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
install_nginx() {
  step "瀹夎閰嶇疆 Nginx"
  apt install -y -qq nginx

  # 涓存椂 HTTP 閰嶇疆锛堢敤浜?certbot 楠岃瘉锛?  cat > /etc/nginx/sites-available/conjiweb << EOF
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
  success "Nginx 涓存椂閰嶇疆瀹屾垚"
}

# 鈹€鈹€ 12. 鐢宠 SSL 璇佷功 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
setup_ssl() {
  step "鐢宠 Let's Encrypt SSL 璇佷功"
  apt install -y -qq certbot python3-certbot-nginx

  local cert_dir="/etc/letsencrypt/live/${DOMAIN}"
  local cert_fullchain="${cert_dir}/fullchain.pem"
  local cert_privkey="${cert_dir}/privkey.pem"
  local has_usable_cert=0
  if [[ -f "$cert_fullchain" && -f "$cert_privkey" ]]; then
    if openssl x509 -checkend 86400 -noout -in "$cert_fullchain" >/dev/null 2>&1; then
      has_usable_cert=1
      info "妫€娴嬪埌鍙敤璇佷功锛岃烦杩囬噸鏂扮敵璇?
    fi
  fi

  if [[ "$has_usable_cert" -eq 0 ]]; then
    certbot certonly --nginx \
      -d "${DOMAIN}" \
      --email "${EMAIL}" \
      --agree-tos \
      --non-interactive
    success "SSL 璇佷功鐢宠鎴愬姛"
  fi

  # 鍐欏叆姝ｅ紡 HTTPS Nginx 閰嶇疆
  cp configs/nginx/conjiweb.conf /etc/nginx/sites-available/conjiweb
  sed -i "s|DOMAIN|${DOMAIN}|g" /etc/nginx/sites-available/conjiweb
  sed -i "s|INSTALL_DIR|${INSTALL_DIR}|g" /etc/nginx/sites-available/conjiweb
  cat > /etc/nginx/conf.d/conjiweb-rate-limit.conf << 'EOF'
limit_req_zone $binary_remote_addr zone=api_auth:10m rate=30r/m;
EOF

  nginx -t && systemctl reload nginx
  success "Nginx HTTPS 閰嶇疆瀹屾垚"

  # 鑷姩缁湡
  systemctl enable certbot.timer
  systemctl start certbot.timer
}

# 鈹€鈹€ 13. 閰嶇疆闃茬伀澧?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
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
      warn "褰撳墠浼氳瘽涓嶅彲浜や簰锛岄粯璁ゆ寜 no 澶勭悊: ${prompt}"
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

    info "鏈娴嬪埌鐜版湁 SSH 绉侀挜锛岃嚜鍔ㄥ垱寤?${ssh_dir}/id_ed25519"
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

  step "閰嶇疆闃茬伀澧?(ufw)"
  local ssh_ports_raw
  ssh_ports_raw="$(detect_ssh_ports)"
  if [[ -z "${SSH_PORT:-}" ]]; then
    SSH_PORT="$ssh_ports_raw"
  fi
  SSH_PORT="${SSH_PORT//,/ }"
  SSH_PORT="$(echo "$SSH_PORT" | tr -s '[:space:]' ' ' | sed 's/^ //; s/ $//')"
  [[ -n "$SSH_PORT" ]] || error "鏃犳硶纭畾 SSH 绔彛锛岃閫氳繃 --ssh-port 鎵嬪姩鎸囧畾"
  local p
  for p in $SSH_PORT; do
    validate_port "$p" || error "鏃犳晥 SSH 绔彛: ${p}"
  done
  info "鑷姩鎵弿鍒?SSH 绔彛: ${SSH_PORT}"

  local has_port_22=0
  for p in $SSH_PORT; do
    if [[ "$p" == "22" ]]; then
      has_port_22=1
      break
    fi
  done
  if [[ "$has_port_22" -eq 1 ]] && prompt_yes_no "妫€娴嬪埌 SSH 绔彛鍖呭惈 22锛屾槸鍚︽敼鎴愬叾瀹冪櫥褰曠鍙ｏ紵"; then
    local new_ssh_port=""
    while true; do
      new_ssh_port="$(prompt_input "璇疯緭鍏ユ柊鐨?SSH 绔彛鍙? " || true)"
      [[ -n "$new_ssh_port" ]] || { warn "鏈鍙栧埌绔彛杈撳叆锛岃閲嶈瘯"; continue; }
      new_ssh_port="${new_ssh_port// /}"
      validate_port "$new_ssh_port" || { warn "绔彛鏃犳晥锛岃閲嶆柊杈撳叆"; continue; }
      [[ "$new_ssh_port" != "22" ]] || { warn "鏂扮鍙ｄ笉鑳芥槸 22锛岃閲嶆柊杈撳叆"; continue; }
      break
    done
    apply_sshd_port "$new_ssh_port"
    SSH_PORT="$new_ssh_port"
    info "SSH 鐧诲綍绔彛宸插垏鎹负: ${SSH_PORT}"
  fi

  if prompt_yes_no "鏄惁鑷姩閰嶇疆 SSH 瀵嗛挜鐧诲綍锛堝苟淇濈暀瀵嗙爜鐧诲綍锛夛紵"; then
    local detected_pub_key=""
    detected_pub_key="$(detect_or_create_local_public_key)"
    [[ -n "$detected_pub_key" ]] || error "鏈兘鑾峰彇鍙敤鍏挜"
    add_key_to_authorized_keys "$detected_pub_key"
    apply_sshd_dropin_and_reload
    success "宸查厤缃瘑閽ョ櫥褰曪紝骞舵槑纭繚鐣欏瘑鐮佺櫥褰?
  fi

  if ! prompt_yes_no "纭鎸変笂杩?SSH 绔彛閰嶇疆 UFW锛屽苟浠呮斁琛?80/443/5222/5269锛?; then
    warn "宸插彇娑堥槻鐏鏀瑰姩锛堟湭杈撳叆 yes锛?
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
  ufw allow 5269/tcp   # XMPP 鏈嶅姟鍣ㄩ棿
  # 涓嶅紑鏀?9000/9001锛圡inIO 浠呭唴閮ㄨ闂級
  # 涓嶅紑鏀?5432锛圥ostgreSQL 浠呭唴閮ㄨ闂級
  # 涓嶅紑鏀?6379锛圧edis 浠呭唴閮ㄨ闂級
  ufw --force enable
  success "闃茬伀澧欓厤缃畬鎴?
}

# 鈹€鈹€ 14. 閰嶇疆 fail2ban 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
setup_fail2ban() {
  step "配置 fail2ban（防暴力破解）"
  cat > /etc/fail2ban/filter.d/conjiweb-api.conf << 'EOF'
[Definition]
failregex = ^<HOST> - .* "(POST|PUT) /api/auth/admin/login HTTP.*" (401|403|429) .*
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
  success "fail2ban 配置完成"
}

# 15. 鍒涘缓澶囦唤鑴氭湰 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
setup_backup() {
  step "閰嶇疆鑷姩澶囦唤"
  mkdir -p /root/backups
  chmod 700 /root/backups

  cat > /usr/local/bin/conjiweb-backup.sh << BACKUP
#!/bin/bash
set -euo pipefail
BACKUP_DIR="/root/backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_REMOTE="${BACKUP_REMOTE}"
mkdir -p "$BACKUP_DIR"

# Backup PostgreSQL
sudo -u postgres pg_dump conjiweb | gzip > "${BACKUP_DIR}/db_${DATE}.sql.gz"
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
  step "配置日志轮转与 journald 限额"
  cp "${SRC_DIR}/configs/logrotate/conjiweb" /etc/logrotate.d/conjiweb

  mkdir -p /etc/systemd/journald.conf.d
  cat > /etc/systemd/journald.conf.d/conjiweb.conf << 'EOF'
[Journal]
SystemMaxUse=500M
EOF
  systemctl restart systemd-journald || true
  success "日志轮转配置完成"
}

setup_monitoring_alert() {
  step "配置轻量服务监控与自愈脚本"
  cat > /usr/local/bin/conjiweb-alert.sh << 'EOF'
#!/usr/bin/env bash
set -euo pipefail
services=(postgresql redis-server prosody conjiweb-api nginx)
for svc in "${services[@]}"; do
  if ! systemctl is-active --quiet "$svc"; then
    echo "$(date '+%F %T') WARN service down: $svc" >> /var/log/conjiweb-alert.log
    systemctl restart "$svc" || true
  fi
done
EOF
  chmod +x /usr/local/bin/conjiweb-alert.sh
  echo "*/5 * * * * root /usr/local/bin/conjiweb-alert.sh" > /etc/cron.d/conjiweb-alert
  success "监控告警脚本配置完成（每5分钟）"
}

# 鈹€鈹€ 16. 鐢熸垚蹇€熼獙鏀跺懡浠?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
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
EOF
  chmod 600 "${secrets_file}"
}

# 鈹€鈹€ 17. 杈撳嚭瀹夎鎽樿 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
print_summary() {
  echo ""
  echo -e "${GREEN}鈺斺晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晽${NC}"
  echo -e "${GREEN}鈺?           Conjiweb 瀹夎瀹屾垚锛?                         鈺?{NC}"
  echo -e "${GREEN}鈺氣晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨暆${NC}"
  echo ""
  echo -e "  ${CYAN}鍓嶇鍦板潃锛?{NC}   https://${DOMAIN}"
  echo -e "  ${CYAN}API 鏂囨。锛?{NC}   https://${DOMAIN}/api/docs"
  echo -e "  ${CYAN}XMPP 鍩熷悕锛?{NC} ${XMPP_DOMAIN}"
  echo -e "  ${CYAN}WebSocket锛?{NC} wss://${DOMAIN}/xmpp-websocket"
  echo ""
  echo -e "  ${YELLOW}榛樿 XMPP 鐧诲綍璐﹀彿锛?{NC}"
  echo -e "  JID: ${XMPP_ADMIN_JID:-${XMPP_ADMIN_USER}@${XMPP_DOMAIN}}"
  if [[ "${XMPP_ADMIN_CREATED}" = "1" ]]; then
    echo -e "  瀵嗙爜: ${XMPP_ADMIN_PASS}"
  else
    echo -e "  瀵嗙爜: 锛堝凡瀛樺湪璐﹀彿锛屼繚鎸佸師瀵嗙爜锛?
  fi
  echo ""
  echo -e "  ${YELLOW}甯哥敤绠＄悊鍛戒护锛?{NC}"
  echo -e "  systemctl status conjiweb-api   # 鏌ョ湅 API 鐘舵€?
  echo -e "  journalctl -u conjiweb-api -f   # 鏌ョ湅 API 鏃ュ織"
  echo -e "  systemctl status prosody        # 鏌ョ湅 XMPP 鐘舵€?
  echo -e "  systemctl status nginx          # 鏌ョ湅 Nginx 鐘舵€?
  echo -e "  conjiweb-backup.sh              # 绔嬪嵆澶囦唤"
  echo -e "  conjiweb-check ${DOMAIN}        # 30绉掗獙鏀?
  echo ""
  echo -e "  Secrets file: /root/conjiweb-secrets.txt (chmod 600)"
  echo ""
  echo -e "  ${RED}璇蜂繚瀛樹互涓嬪瘑鐮侊紙鍙樉绀轰竴娆★級锛?{NC}"
  echo -e "  鏁版嵁搴撳瘑鐮? ${DB_PASS}"
  echo -e "  Redis 瀵嗙爜: ${REDIS_PASS}"
  echo -e "  MinIO 瀵嗙爜: ${MINIO_ROOT_PASSWORD}"
  echo ""
}

# 鈹€鈹€ 涓绘祦绋?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
main() {
  SRC_DIR="$(pwd -P)"
  [[ -d "${SRC_DIR}/apps/api" ]] || error "缂哄皯婧愮爜鐩綍: ${SRC_DIR}/apps/api"
  [[ -d "${SRC_DIR}/apps/web" ]] || error "缂哄皯婧愮爜鐩綍: ${SRC_DIR}/apps/web"

  echo -e "${CYAN}"
  echo "   鈻堚枅鈻堚枅鈻堚枅鈺?鈻堚枅鈻堚枅鈻堚枅鈺?鈻堚枅鈻堚晽   鈻堚枅鈺?    鈻堚枅鈺椻枅鈻堚晽鈻堚枅鈺?   鈻堚枅鈺椻枅鈻堚枅鈻堚枅鈻堚枅鈺椻枅鈻堚枅鈻堚枅鈻堚晽 "
  echo "  鈻堚枅鈺斺晲鈺愨晲鈺愨暆鈻堚枅鈺斺晲鈺愨晲鈻堚枅鈺椻枅鈻堚枅鈻堚晽  鈻堚枅鈺?    鈻堚枅鈺戔枅鈻堚晳鈻堚枅鈺?   鈻堚枅鈺戔枅鈻堚晹鈺愨晲鈺愨晲鈺濃枅鈻堚晹鈺愨晲鈻堚枅鈺?
  echo "  鈻堚枅鈺?    鈻堚枅鈺?  鈻堚枅鈺戔枅鈻堚晹鈻堚枅鈺?鈻堚枅鈺?    鈻堚枅鈺戔枅鈻堚晳鈻堚枅鈺?鈻堚晽 鈻堚枅鈺戔枅鈻堚枅鈻堚枅鈺? 鈻堚枅鈻堚枅鈻堚枅鈺斺暆"
  echo "  鈻堚枅鈺?    鈻堚枅鈺?  鈻堚枅鈺戔枅鈻堚晳鈺氣枅鈻堚晽鈻堚枅鈺戔枅鈻?  鈻堚枅鈺戔枅鈻堚晳鈻堚枅鈺戔枅鈻堚枅鈺椻枅鈻堚晳鈻堚枅鈺斺晲鈺愨暆  鈻堚枅鈺斺晲鈺愨枅鈻堚晽"
  echo "  鈺氣枅鈻堚枅鈻堚枅鈻堚晽鈺氣枅鈻堚枅鈻堚枅鈻堚晹鈺濃枅鈻堚晳 鈺氣枅鈻堚枅鈻堚晳鈺氣枅鈻堚枅鈻堚枅鈺斺暆鈻堚枅鈺戔暁鈻堚枅鈻堚晹鈻堚枅鈻堚晹鈺濃枅鈻堚枅鈻堚枅鈻堚枅鈺椻枅鈻堚枅鈻堚枅鈻堚晹鈺?
  echo "   鈺氣晲鈺愨晲鈺愨晲鈺?鈺氣晲鈺愨晲鈺愨晲鈺?鈺氣晲鈺? 鈺氣晲鈺愨晲鈺?鈺氣晲鈺愨晲鈺愨暆 鈺氣晲鈺?鈺氣晲鈺愨暆鈺氣晲鈺愨暆 鈺氣晲鈺愨晲鈺愨晲鈺愨暆鈺氣晲鈺愨晲鈺愨晲鈺?"
  echo -e "${NC}"
  echo -e "  ${BLUE}Conjiweb 路 Installer${NC}"
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
