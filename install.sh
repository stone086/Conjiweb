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
DOMAIN=""
EMAIL=""
SRC_DIR=""
RUN_LOCAL=0
REPO_URL=""
BRANCH="main"
PROJECT_PATH=""
TARGET_DIR="/opt/conjiweb-src"

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
  exec bash install.sh --run-local
}

# 鈹€鈹€ 璇诲彇閰嶇疆鏂囦欢 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
load_config() {
  if [ ! -f ".env" ]; then
    error ".env 鏂囦欢涓嶅瓨鍦紝璇峰厛澶嶅埗: cp .env.example .env 骞跺～鍐欓厤缃?
  fi
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
  step "閰嶇疆鏃ユ湰 apt 闀滃儚婧?
  cat > /etc/apt/sources.list << 'EOF'
deb http://ftp.riken.jp/Linux/debian/debian/ bookworm main contrib non-free non-free-firmware
deb http://ftp.riken.jp/Linux/debian/debian/ bookworm-updates main contrib non-free non-free-firmware
deb http://ftp.riken.jp/Linux/debian/debian-security/ bookworm-security main contrib non-free non-free-firmware
EOF
  apt update -qq
  success "apt 婧愬凡鍒囨崲鍒版棩鏈悊鍖栧鐮旂┒鎵€闀滃儚"
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

  sudo -u postgres psql -c "CREATE USER ${APP_USER} WITH PASSWORD '${DB_PASS}';" 2>/dev/null || true
  sudo -u postgres psql -c "ALTER USER ${APP_USER} WITH PASSWORD '${DB_PASS}';" 2>/dev/null || true
  sudo -u postgres psql -c "CREATE DATABASE ${APP_USER} OWNER ${APP_USER};" 2>/dev/null || true
  sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${APP_USER} TO ${APP_USER};" 2>/dev/null || true

  # 鍐呭瓨浼樺寲锛堥€傚悎 2GB VPS锛?  PG_CONF="/etc/postgresql/16/main/postgresql.conf"
  sed -i "s|#shared_buffers = 128MB|shared_buffers = 256MB|" "$PG_CONF"
  sed -i "s|#work_mem = 4MB|work_mem = 8MB|" "$PG_CONF"
  sed -i "s|#maintenance_work_mem = 64MB|maintenance_work_mem = 64MB|" "$PG_CONF"
  sed -i "s|#effective_cache_size = 4GB|effective_cache_size = 512MB|" "$PG_CONF"
  systemctl restart postgresql

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

  cat > /etc/systemd/system/minio.service << EOF
[Unit]
Description=MinIO Object Storage
After=network.target

[Service]
User=root
Group=root
Environment="MINIO_ROOT_USER=${MINIO_ROOT_USER}"
Environment="MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}"
Environment="MINIO_VOLUMES=/data/minio"
ExecStart=/usr/local/bin/minio server /data/minio --console-address ":9001" --address ":9000"
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
  /usr/local/bin/mc anonymous set download local/conjiweb-files --quiet 2>/dev/null || true

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

  cd "${INSTALL_DIR}/api"
  python3.11 -m venv .venv
  .venv/bin/pip install -q --upgrade pip
  .venv/bin/pip install -q -r requirements.txt

  # 鐢熸垚 API .env
  cat > "${INSTALL_DIR}/api/.env" << EOF
DATABASE_URL=postgresql+asyncpg://${APP_USER}:${DB_PASS}@127.0.0.1:5432/${APP_USER}
REDIS_URL=redis://:${REDIS_PASS}@127.0.0.1:6379/0
MINIO_ENDPOINT=127.0.0.1:9000
MINIO_ACCESS_KEY=${MINIO_ROOT_USER}
MINIO_SECRET_KEY=${MINIO_ROOT_PASSWORD}
MINIO_BUCKET=conjiweb-files
MINIO_SECURE=false
SECRET_KEY=${SECRET_KEY}
CORS_ORIGINS=["https://${DOMAIN}"]
EOF

  # 杩愯鏁版嵁搴撹縼绉?  cd "${INSTALL_DIR}/api"
  .venv/bin/alembic upgrade head

  # 鍒涘缓 systemd 鏈嶅姟
  cat > /etc/systemd/system/conjiweb-api.service << EOF
[Unit]
Description=Conjiweb FastAPI Backend
After=network.target postgresql.service redis.service
Requires=postgresql.service

[Service]
User=root
WorkingDirectory=${INSTALL_DIR}/api
EnvironmentFile=${INSTALL_DIR}/api/.env
ExecStart=${INSTALL_DIR}/api/.venv/bin/uvicorn app.main:app \\
    --host 127.0.0.1 \\
    --port 8000 \\
    --workers 2 \\
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
VITE_API_URL=https://${DOMAIN}
VITE_XMPP_WS_URL=wss://${DOMAIN}/xmpp-websocket
EOF

  npm ci --silent
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

  certbot certonly --nginx \
    -d "${DOMAIN}" \
    --email "${EMAIL}" \
    --agree-tos \
    --non-interactive \
    --redirect

  success "SSL 璇佷功鐢宠鎴愬姛"

  # 鍐欏叆姝ｅ紡 HTTPS Nginx 閰嶇疆
  cp configs/nginx/conjiweb.conf /etc/nginx/sites-available/conjiweb
  sed -i "s|DOMAIN|${DOMAIN}|g" /etc/nginx/sites-available/conjiweb
  sed -i "s|INSTALL_DIR|${INSTALL_DIR}|g" /etc/nginx/sites-available/conjiweb

  nginx -t && systemctl reload nginx
  success "Nginx HTTPS 閰嶇疆瀹屾垚"

  # 鑷姩缁湡
  systemctl enable certbot.timer
  systemctl start certbot.timer
}

# 鈹€鈹€ 13. 閰嶇疆闃茬伀澧?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
setup_firewall() {
  step "閰嶇疆闃茬伀澧?(ufw)"
  ufw --force reset
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow ssh
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
  step "閰嶇疆 fail2ban锛堥槻鏆村姏鐮磋В锛?
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
EOF
  systemctl enable fail2ban
  systemctl restart fail2ban
  success "fail2ban 閰嶇疆瀹屾垚"
}

# 鈹€鈹€ 15. 鍒涘缓澶囦唤鑴氭湰 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
setup_backup() {
  step "閰嶇疆鑷姩澶囦唤"
  mkdir -p /root/backups

  cat > /usr/local/bin/conjiweb-backup.sh << 'BACKUP'
#!/bin/bash
BACKUP_DIR="/root/backups"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"

# 澶囦唤鏁版嵁搴?sudo -u postgres pg_dump conjiweb | gzip > "${BACKUP_DIR}/db_${DATE}.sql.gz"

# 澶囦唤 MinIO 鏁版嵁
tar czf "${BACKUP_DIR}/minio_${DATE}.tar.gz" /data/minio/ 2>/dev/null || true

# 淇濈暀鏈€杩?7 澶?find "$BACKUP_DIR" -name "*.gz" -mtime +7 -delete

echo "澶囦唤瀹屾垚: ${DATE}"
BACKUP
  chmod +x /usr/local/bin/conjiweb-backup.sh

  # 姣忓ぉ鍑屾櫒 3 鐐瑰浠?  echo "0 3 * * * root /usr/local/bin/conjiweb-backup.sh >> /var/log/conjiweb-backup.log 2>&1" \
    > /etc/cron.d/conjiweb-backup

  success "澶囦唤鑴氭湰閰嶇疆瀹屾垚锛堟瘡澶?03:00 鑷姩澶囦唤锛?
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
  echo -e "  ${YELLOW}涓嬩竴姝ワ細鍒涘缓 XMPP 鐢ㄦ埛${NC}"
  echo -e "  prosodyctl adduser yourname@${XMPP_DOMAIN}"
  echo ""
  echo -e "  ${YELLOW}甯哥敤绠＄悊鍛戒护锛?{NC}"
  echo -e "  systemctl status conjiweb-api   # 鏌ョ湅 API 鐘舵€?
  echo -e "  journalctl -u conjiweb-api -f   # 鏌ョ湅 API 鏃ュ織"
  echo -e "  systemctl status prosody        # 鏌ョ湅 XMPP 鐘舵€?
  echo -e "  systemctl status nginx          # 鏌ョ湅 Nginx 鐘舵€?
  echo -e "  conjiweb-backup.sh              # 绔嬪嵆澶囦唤"
  echo -e "  conjiweb-check ${DOMAIN}        # 30绉掗獙鏀?
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
  install_deps
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
  print_summary
}

parse_bootstrap_args "$@"
bootstrap_if_needed
main
