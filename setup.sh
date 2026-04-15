#!/usr/bin/env bash
# =============================================================================
#  Conjiweb — Install Script
#  Target: Debian/Linux VPS (root)
#  Usage:  bash setup.sh
# =============================================================================
set -euo pipefail

# ── 颜色输出 ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERR]${NC}  $*"; exit 1; }
step()    { echo -e "\n${CYAN}━━━ $* ━━━${NC}"; }

# ── 配置变量（安装前自动读取 .env） ───────────────────────────────────────────
INSTALL_DIR="/opt/conjiweb"
APP_USER="webgajim"
DOMAIN=""
EMAIL=""
SRC_DIR=""

# ── 读取配置文件 ───────────────────────────────────────────────────────────────
load_config() {
  if [ ! -f ".env" ]; then
    error ".env 文件不存在，请先复制: cp .env.example .env 并填写配置"
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
  ADMIN_USER="${ADMIN_USER:-admin}"
  ADMIN_PASS="${ADMIN_PASS:-$(openssl rand -hex 8)}"
  XMPP_DOMAIN="${XMPP_DOMAIN:-localhost}"

  [ -z "$DOMAIN" ] && error "请在 .env 中设置 DOMAIN=你的域名"
  [ -z "$EMAIL" ]  && error "请在 .env 中设置 EMAIL=你的邮箱（用于申请 SSL 证书）"

  # 更新 .env 写回随机生成的值
  sed -i "s|^DB_PASS=.*|DB_PASS=${DB_PASS}|" .env
  sed -i "s|^REDIS_PASS=.*|REDIS_PASS=${REDIS_PASS}|" .env
  sed -i "s|^MINIO_ROOT_PASSWORD=.*|MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}|" .env
  sed -i "s|^SECRET_KEY=.*|SECRET_KEY=${SECRET_KEY}|" .env
  sed -i "s|^ADMIN_PASS=.*|ADMIN_PASS=${ADMIN_PASS}|" .env
}

# ── 1. 系统检查 ────────────────────────────────────────────────────────────────
check_system() {
  step "系统检查"
  [ "$(id -u)" -eq 0 ] || error "请使用 root 用户运行"

  OS=$(grep -oP '(?<=^ID=).+' /etc/os-release | tr -d '"')
  VER=$(grep -oP '(?<=^VERSION_ID=).+' /etc/os-release | tr -d '"')
  [ "$OS" = "debian" ] && [ "$VER" = "12" ] || warn "建议在 Debian 12 上运行，当前: $OS $VER"

  MEM=$(free -m | awk '/^Mem:/{print $2}')
  info "内存: ${MEM}MB"
  [ "$MEM" -lt 1500 ] && warn "内存不足 1.5GB，可能影响稳定性"

  success "系统检查通过"
}

# ── 2. 换日本 apt 源（理化学研究所镜像，速度快） ───────────────────────────────
setup_apt_mirror() {
  step "配置日本 apt 镜像源"
  cat > /etc/apt/sources.list << 'EOF'
deb http://ftp.riken.jp/Linux/debian/debian/ bookworm main contrib non-free non-free-firmware
deb http://ftp.riken.jp/Linux/debian/debian/ bookworm-updates main contrib non-free non-free-firmware
deb http://ftp.riken.jp/Linux/debian/debian-security/ bookworm-security main contrib non-free non-free-firmware
EOF
  apt update -qq
  success "apt 源已切换到日本理化学研究所镜像"
}

# ── 3. 安装系统依赖 ────────────────────────────────────────────────────────────
install_deps() {
  step "安装系统依赖"
  apt install -y -qq \
    curl wget git unzip build-essential \
    ca-certificates gnupg lsb-release \
    openssl htop vim ufw fail2ban \
    python3.11 python3.11-venv python3-pip \
    libpq-dev libssl-dev libffi-dev
  success "系统依赖安装完成"
}

# ── 4. 安装 PostgreSQL 16 ──────────────────────────────────────────────────────
install_postgres() {
  step "安装 PostgreSQL 16"
  # 官方日本镜像
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | \
    gpg --dearmor -o /etc/apt/keyrings/postgresql.gpg
  echo "deb [signed-by=/etc/apt/keyrings/postgresql.gpg] \
    https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  apt update -qq
  apt install -y -qq postgresql-16

  systemctl enable postgresql
  systemctl start postgresql

  sudo -u postgres psql -c "CREATE USER ${APP_USER} WITH PASSWORD '${DB_PASS}';" 2>/dev/null || true
  sudo -u postgres psql -c "CREATE DATABASE ${APP_USER} OWNER ${APP_USER};" 2>/dev/null || true
  sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${APP_USER} TO ${APP_USER};" 2>/dev/null || true

  # 内存优化（适合 2GB VPS）
  PG_CONF="/etc/postgresql/16/main/postgresql.conf"
  sed -i "s|#shared_buffers = 128MB|shared_buffers = 256MB|" "$PG_CONF"
  sed -i "s|#work_mem = 4MB|work_mem = 8MB|" "$PG_CONF"
  sed -i "s|#maintenance_work_mem = 64MB|maintenance_work_mem = 64MB|" "$PG_CONF"
  sed -i "s|#effective_cache_size = 4GB|effective_cache_size = 512MB|" "$PG_CONF"
  systemctl restart postgresql

  success "PostgreSQL 16 安装完成，数据库: ${APP_USER}"
}

# ── 5. 安装 Redis 7 ────────────────────────────────────────────────────────────
install_redis() {
  step "安装 Redis 7"
  apt install -y -qq redis-server

  REDIS_CONF="/etc/redis/redis.conf"
  sed -i "s|# requirepass foobared|requirepass ${REDIS_PASS}|" "$REDIS_CONF"
  sed -i "s|# maxmemory <bytes>|maxmemory 256mb|" "$REDIS_CONF"
  sed -i "s|# maxmemory-policy noeviction|maxmemory-policy allkeys-lru|" "$REDIS_CONF"
  # 绑定仅本地
  sed -i "s|^bind 127.0.0.1 ::1|bind 127.0.0.1|" "$REDIS_CONF"

  systemctl enable redis-server
  systemctl restart redis-server
  success "Redis 7 安装完成"
}

# ── 6. 安装 Prosody XMPP ──────────────────────────────────────────────────────
install_prosody() {
  step "安装 Prosody XMPP 服务器"
  apt install -y -qq prosody lua-dbi-postgresql

  # 写入配置
  cp configs/prosody/prosody.cfg.lua /etc/prosody/prosody.cfg.lua
  # 替换域名
  sed -i "s|XMPP_DOMAIN|${XMPP_DOMAIN}|g" /etc/prosody/prosody.cfg.lua

  prosodyctl check config 2>/dev/null || true
  systemctl enable prosody
  systemctl restart prosody
  success "Prosody 安装完成，域名: ${XMPP_DOMAIN}"
}

# ── 7. 安装 MinIO ──────────────────────────────────────────────────────────────
install_minio() {
  step "安装 MinIO 对象存储"
  wget -q https://dl.min.io/server/minio/release/linux-amd64/minio \
    -O /usr/local/bin/minio
  chmod +x /usr/local/bin/minio

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

  # 等待 MinIO 启动
  sleep 3

  # 创建默认 bucket
  wget -q https://dl.min.io/client/mc/release/linux-amd64/mc \
    -O /usr/local/bin/mc
  chmod +x /usr/local/bin/mc
  /usr/local/bin/mc alias set local http://127.0.0.1:9000 \
    "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}" --quiet 2>/dev/null || true
  /usr/local/bin/mc mb local/webgajim-files --quiet 2>/dev/null || true
  /usr/local/bin/mc anonymous set download local/webgajim-files --quiet 2>/dev/null || true

  success "MinIO 安装完成，Bucket: webgajim-files"
}

# ── 8. 安装 Node.js 20 ─────────────────────────────────────────────────────────
install_nodejs() {
  step "安装 Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
  apt install -y -qq nodejs
  success "Node.js $(node --version) 安装完成"
}

# ── 9. 部署后端 API ───────────────────────────────────────────────────────────
deploy_api() {
  step "部署 FastAPI 后端"
  mkdir -p "${INSTALL_DIR}"
  rm -rf "${INSTALL_DIR}/api"
  cp -r "${SRC_DIR}/apps/api" "${INSTALL_DIR}/api"

  cd "${INSTALL_DIR}/api"
  python3.11 -m venv .venv
  .venv/bin/pip install -q --upgrade pip
  .venv/bin/pip install -q -r requirements.txt

  # 生成 API .env
  cat > "${INSTALL_DIR}/api/.env" << EOF
DATABASE_URL=postgresql+asyncpg://${APP_USER}:${DB_PASS}@127.0.0.1:5432/${APP_USER}
REDIS_URL=redis://:${REDIS_PASS}@127.0.0.1:6379/0
MINIO_ENDPOINT=127.0.0.1:9000
MINIO_ACCESS_KEY=${MINIO_ROOT_USER}
MINIO_SECRET_KEY=${MINIO_ROOT_PASSWORD}
MINIO_BUCKET=webgajim-files
MINIO_SECURE=false
SECRET_KEY=${SECRET_KEY}
CORS_ORIGINS=["https://${DOMAIN}"]
ADMIN_USER=${ADMIN_USER}
ADMIN_PASS=${ADMIN_PASS}
EOF

  # 运行数据库迁移
  cd "${INSTALL_DIR}/api"
  .venv/bin/alembic upgrade head || true

  # 创建 systemd 服务
  cat > /etc/systemd/system/webgajim-api.service << EOF
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
  systemctl enable webgajim-api
  systemctl start webgajim-api
  sleep 2

  cd "${SRC_DIR}"
  success "FastAPI 后端部署完成，监听 127.0.0.1:8000"
}

# ── 10. 构建并部署前端 ────────────────────────────────────────────────────────
deploy_frontend() {
  step "构建前端（React + Vite）"
  rm -rf "${INSTALL_DIR}/web"
  cp -r "${SRC_DIR}/apps/web" "${INSTALL_DIR}/web"
  cd "${INSTALL_DIR}/web"

  # 写入前端环境变量
  cat > .env.production << EOF
VITE_API_URL=https://${DOMAIN}
VITE_XMPP_WS_URL=wss://${DOMAIN}/xmpp-websocket
EOF

  npm ci --silent
  npm run build

  FRONTEND_DIST="${INSTALL_DIR}/web/dist"
  cd "${SRC_DIR}"
  success "前端构建完成，输出目录: ${FRONTEND_DIST}"
}

# ── 11. 安装配置 Nginx ────────────────────────────────────────────────────────
install_nginx() {
  step "安装配置 Nginx"
  apt install -y -qq nginx

  # 临时 HTTP 配置（用于 certbot 验证）
  cat > /etc/nginx/sites-available/webgajim << EOF
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

  ln -sf /etc/nginx/sites-available/webgajim /etc/nginx/sites-enabled/webgajim
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl restart nginx
  success "Nginx 临时配置完成"
}

# ── 12. 申请 SSL 证书 ─────────────────────────────────────────────────────────
setup_ssl() {
  step "申请 Let's Encrypt SSL 证书"
  apt install -y -qq certbot python3-certbot-nginx

  certbot certonly --nginx \
    -d "${DOMAIN}" \
    --email "${EMAIL}" \
    --agree-tos \
    --non-interactive \
    --redirect

  success "SSL 证书申请成功"

  # 写入正式 HTTPS Nginx 配置
  cp configs/nginx/webgajim.conf /etc/nginx/sites-available/webgajim
  sed -i "s|DOMAIN|${DOMAIN}|g" /etc/nginx/sites-available/webgajim
  sed -i "s|INSTALL_DIR|${INSTALL_DIR}|g" /etc/nginx/sites-available/webgajim

  nginx -t && systemctl reload nginx
  success "Nginx HTTPS 配置完成"

  # 自动续期
  systemctl enable certbot.timer
  systemctl start certbot.timer
}

# ── 13. 配置防火墙 ────────────────────────────────────────────────────────────
setup_firewall() {
  step "配置防火墙 (ufw)"
  ufw --force reset
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow ssh
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow 5222/tcp   # XMPP TCP
  ufw allow 5269/tcp   # XMPP 服务器间
  # 不开放 9000/9001（MinIO 仅内部访问）
  # 不开放 5432（PostgreSQL 仅内部访问）
  # 不开放 6379（Redis 仅内部访问）
  ufw --force enable
  success "防火墙配置完成"
}

# ── 14. 配置 fail2ban ─────────────────────────────────────────────────────────
setup_fail2ban() {
  step "配置 fail2ban（防暴力破解）"
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
  success "fail2ban 配置完成"
}

# ── 15. 创建备份脚本 ──────────────────────────────────────────────────────────
setup_backup() {
  step "配置自动备份"
  mkdir -p /root/backups

  cat > /usr/local/bin/webgajim-backup.sh << 'BACKUP'
#!/bin/bash
BACKUP_DIR="/root/backups"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"

# 备份数据库
sudo -u postgres pg_dump webgajim | gzip > "${BACKUP_DIR}/db_${DATE}.sql.gz"

# 备份 MinIO 数据
tar czf "${BACKUP_DIR}/minio_${DATE}.tar.gz" /data/minio/ 2>/dev/null || true

# 保留最近 7 天
find "$BACKUP_DIR" -name "*.gz" -mtime +7 -delete

echo "备份完成: ${DATE}"
BACKUP
  chmod +x /usr/local/bin/webgajim-backup.sh

  # 每天凌晨 3 点备份
  echo "0 3 * * * root /usr/local/bin/webgajim-backup.sh >> /var/log/webgajim-backup.log 2>&1" \
    > /etc/cron.d/webgajim-backup

  success "备份脚本配置完成（每天 03:00 自动备份）"
}

# ── 16. 输出安装摘要 ──────────────────────────────────────────────────────────
print_summary() {
  echo ""
  echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║            Conjiweb 安装完成！                          ║${NC}"
  echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  ${CYAN}前端地址：${NC}   https://${DOMAIN}"
  echo -e "  ${CYAN}API 文档：${NC}   https://${DOMAIN}/api/docs"
  echo -e "  ${CYAN}后台登录：${NC}   用户 ${ADMIN_USER} / 密码 ${ADMIN_PASS}"
  echo ""
  echo -e "  ${CYAN}XMPP 域名：${NC} ${XMPP_DOMAIN}"
  echo -e "  ${CYAN}WebSocket：${NC} wss://${DOMAIN}/xmpp-websocket"
  echo ""
  echo -e "  ${YELLOW}下一步：创建 XMPP 用户${NC}"
  echo -e "  prosodyctl adduser yourname@${XMPP_DOMAIN}"
  echo ""
  echo -e "  ${YELLOW}常用管理命令：${NC}"
  echo -e "  systemctl status webgajim-api   # 查看 API 状态"
  echo -e "  journalctl -u webgajim-api -f   # 查看 API 日志"
  echo -e "  systemctl status prosody        # 查看 XMPP 状态"
  echo -e "  systemctl status nginx          # 查看 Nginx 状态"
  echo -e "  webgajim-backup.sh              # 立即备份"
  echo ""
  echo -e "  ${RED}请保存以下密码（只显示一次）：${NC}"
  echo -e "  数据库密码: ${DB_PASS}"
  echo -e "  Redis 密码: ${REDIS_PASS}"
  echo -e "  MinIO 密码: ${MINIO_ROOT_PASSWORD}"
  echo -e "  后台密码:   ${ADMIN_PASS}"
  echo ""
}

# ── 主流程 ────────────────────────────────────────────────────────────────────
main() {
  SRC_DIR="$(pwd -P)"

  echo -e "${CYAN}"
  echo "   ██████╗ ██████╗ ███╗   ██╗     ██╗██╗██╗    ██╗███████╗██████╗ "
  echo "  ██╔════╝██╔═══██╗████╗  ██║     ██║██║██║    ██║██╔════╝██╔══██╗"
  echo "  ██║     ██║   ██║██╔██╗ ██║     ██║██║██║ █╗ ██║█████╗  ██████╔╝"
  echo "  ██║     ██║   ██║██║╚██╗██║██   ██║██║██║███╗██║██╔══╝  ██╔══██╗"
  echo "  ╚██████╗╚██████╔╝██║ ╚████║╚█████╔╝██║╚███╔███╔╝███████╗██████╔╝"
  echo "   ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝ ╚════╝ ╚═╝ ╚══╝╚══╝ ╚══════╝╚═════╝ "
  echo -e "${NC}"
  echo -e "  ${BLUE}Conjiweb · Installer${NC}"
  echo ""

  load_config
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

main "$@"
