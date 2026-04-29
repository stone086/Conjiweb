#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="/opt/conjiweb"
SRC_DIR="/opt/conjiweb-src"
SERVICES=("postgresql" "redis-server" "prosody" "minio" "conjiweb-api" "nginx")

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

run_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

ensure_rsync() {
  if command -v rsync >/dev/null 2>&1; then
    return 0
  fi
  echo -e "${YELLOW}rsync not found, installing...${NC}"
  run_root apt-get update -qq
  run_root apt-get install -y rsync
}

git_fetch_with_retry() {
  local attempts=3
  local delay=3
  local n=1
  while (( n <= attempts )); do
    if git fetch --all --prune; then
      return 0
    fi
    if (( n == attempts )); then
      echo -e "${RED}git fetch failed after ${attempts} attempts${NC}"
      return 1
    fi
    echo -e "${YELLOW}git fetch failed (attempt ${n}/${attempts}), retrying in ${delay}s...${NC}"
    sleep "${delay}"
    n=$((n + 1))
  done
}

usage() {
  echo -e "${CYAN}Conjiweb manage${NC}"
  echo ""
  echo "Usage: bash manage.sh <command>"
  echo ""
  echo "Service:"
  echo "  status          Show service status"
  echo "  start           Start all services"
  echo "  stop            Stop all services"
  echo "  restart         Restart all services"
  echo "  restart-api     Restart API service only"
  echo "  restart-nginx   Reload nginx only"
  echo ""
  echo "Logs:"
  echo "  logs-api        Tail API journal"
  echo "  logs-xmpp       Tail Prosody log"
  echo "  logs-nginx      Tail nginx access log"
  echo "  logs-nginx-err  Tail nginx error log"
  echo ""
  echo "XMPP:"
  echo "  add-user        Add XMPP user"
  echo "  del-user        Delete XMPP user"
  echo "  list-users      List XMPP users"
  echo "  change-pass     Change XMPP user password"
  echo ""
  echo "Ops:"
  echo "  backup          Run backup now"
  echo "  update          Recommended: incremental update (pull + api + frontend)"
  echo "  update-front    Update frontend only"
  echo "  update-api      Update API only"
  echo "  ssl-renew       Renew SSL certificates"
  echo "  db-shell        Open PostgreSQL shell"
  echo "  db-history      Show alembic migration history"
  echo "  db-rollback     Rollback alembic migration"
  echo "  check           Quick health check"
  echo "  api-health      Probe public API health endpoint"
  echo "  cert-info       Show SSL certificate expiry"
  echo "  disk-usage      Show disk usage details"
  echo "  ports           Show listening ports"
  echo "  backup-verify   Verify latest database backup archive integrity"
  echo "  env-check       Validate key runtime env values"
  echo "  top-requests    Top nginx requests from access log"
  echo "  mem-usage       Show process memory usage"
  echo "  watchdog        Run conjiweb watchdog once"
}

load_env() {
  source "${SRC_DIR}/.env" 2>/dev/null || true
}

cmd_status() {
  echo -e "\n${CYAN}== Services ==${NC}"
  for svc in "${SERVICES[@]}"; do
    status="$(systemctl is-active "$svc" 2>/dev/null || echo unknown)"
    if [[ "$status" == "active" ]]; then
      echo -e "  ${GREEN}OK${NC}  $svc"
    else
      echo -e "  ${RED}NO${NC}  $svc ($status)"
    fi
  done

  echo -e "\n${CYAN}== Memory ==${NC}"
  free -h | grep -E "^(Mem|Swap)"
  echo -e "\n${CYAN}== Disk ==${NC}"
  df -h / /data 2>/dev/null || true
}

cmd_start() { for svc in "${SERVICES[@]}"; do systemctl start "$svc"; done; }
cmd_stop() {
  echo "Draining nginx connections..."
  nginx -s quit >/dev/null 2>&1 || true
  sleep 2
  echo "Stopping API gracefully..."
  systemctl stop conjiweb-api 2>/dev/null || true
  sleep 1
  for svc in minio prosody redis-server postgresql; do
    systemctl stop "$svc" 2>/dev/null || true
  done
}
cmd_restart() { for svc in "${SERVICES[@]}"; do systemctl restart "$svc"; done; }

cmd_add_user() {
  load_env
  domain="${XMPP_DOMAIN:-localhost}"
  read -rp "Username: " username
  prosodyctl adduser "${username}@${domain}"
}

cmd_del_user() {
  load_env
  domain="${XMPP_DOMAIN:-localhost}"
  read -rp "Username to delete: " username
  prosodyctl deluser "${username}@${domain}"
}

cmd_list_users() {
  load_env
  domain="${XMPP_DOMAIN:-localhost}"
  prosodyctl list users "$domain"
}

cmd_change_pass() {
  load_env
  domain="${XMPP_DOMAIN:-localhost}"
  read -rp "Username: " username
  prosodyctl passwd "${username}@${domain}"
}

cmd_update_front() {
  load_env
  ensure_rsync
  mkdir -p "${INSTALL_DIR}/web"
  run_root rsync -a --delete \
    --exclude "node_modules" \
    --exclude "dist" \
    --exclude ".env.production" \
    "${SRC_DIR}/apps/web/" "${INSTALL_DIR}/web/"
  cd "${INSTALL_DIR}/web"

  if [[ -n "${DOMAIN:-}" ]]; then
    cat > .env.production <<EOF
VITE_API_URL=https://${DOMAIN}/api
VITE_XMPP_WS_URL=wss://${DOMAIN}/xmpp-websocket
VITE_XMPP_DOMAIN=${XMPP_DOMAIN:-${DOMAIN}}
EOF
  fi

  if [[ -f package-lock.json ]]; then
    npm ci --silent
  else
    npm install --silent --no-audit --no-fund
  fi
  npm run build
  run_root chmod -R a+rX "${INSTALL_DIR}/web/dist" || true
  run_root systemctl reload nginx
  echo -e "${GREEN}Frontend updated${NC}"
}

cmd_update_api() {
  ensure_rsync
  mkdir -p "${INSTALL_DIR}/api"
  run_root rsync -a --delete \
    --exclude ".venv" \
    --exclude ".env" \
    "${SRC_DIR}/apps/api/" "${INSTALL_DIR}/api/"
  [[ -f "${SRC_DIR}/VERSION" ]] && run_root cp "${SRC_DIR}/VERSION" "${INSTALL_DIR}/api/VERSION"
  cd "${INSTALL_DIR}/api"

  if [[ ! -d .venv ]]; then
    python3.11 -m venv .venv
  fi
  .venv/bin/pip install -q --upgrade pip
  .venv/bin/pip install -q -r requirements.txt

  if [[ -f .env && -f alembic.ini ]]; then
    db_url="$(grep '^DATABASE_URL=' .env | cut -d= -f2- || true)"
    if [[ -n "${db_url}" ]]; then
      current_url="$(grep '^sqlalchemy.url = ' alembic.ini | cut -d= -f2- | xargs || true)"
      if [[ -z "${current_url}" || "${current_url}" == "postgresql+asyncpg://user:pass@localhost/dbname" ]]; then
        sed -i "s|^sqlalchemy.url = .*|sqlalchemy.url = ${db_url}|" alembic.ini
      else
        echo "Keeping operator-managed alembic sqlalchemy.url"
      fi
    fi
  fi
  .venv/bin/alembic upgrade head
  run_root systemctl restart conjiweb-api
  echo -e "${GREEN}API updated${NC}"
}

cmd_update_all() {
  echo -e "${CYAN}[1/4] Pull source${NC}"
  cd "${SRC_DIR}"
  current_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
  current_remote="$(git remote | head -n1)"
  [[ -n "${current_remote}" ]] || current_remote="origin"
  git_fetch_with_retry
  git reset --hard "${current_remote}/${current_branch}"

  echo -e "${CYAN}[2/4] Update API${NC}"
  cmd_update_api

  echo -e "${CYAN}[3/4] Update frontend${NC}"
  cmd_update_front

  echo -e "${CYAN}[4/4] Status${NC}"
  cmd_status
}

cmd_mem_usage() {
  ps aux --sort=-%mem | grep -E "(postgres|redis|prosody|minio|uvicorn|nginx)" | grep -v grep | \
    awk '{printf "%-28s %s MB\n", $11, int($6/1024)}'
  echo ""
  free -h
}

cmd_ssl_renew() {
  certbot renew --nginx
  systemctl reload nginx
}

cmd_db_shell() {
  load_env
  db_name="${APP_USER:-conjiweb}"
  sudo -u postgres psql "${db_name}"
}

cmd_db_history() {
  cd "${INSTALL_DIR}/api"
  .venv/bin/alembic history
}

cmd_db_rollback() {
  cd "${INSTALL_DIR}/api"
  echo "Current migration:"
  .venv/bin/alembic current
  read -rp "Rollback target (revision or -1): " target
  [[ -n "${target:-}" ]] || { echo "No target provided"; exit 1; }
  .venv/bin/alembic downgrade "$target"
  systemctl restart conjiweb-api
}

cmd_check() {
  load_env
  if [[ -x /usr/local/bin/conjiweb-check ]]; then
    /usr/local/bin/conjiweb-check "${DOMAIN:-localhost}"
  else
    cmd_status
  fi
}

cmd_api_health() {
  load_env
  local host="${DOMAIN:-localhost}"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS "https://${host}/api/health" || curl -fsS "http://127.0.0.1:8000/api/health"
  else
    echo "curl is required for api-health"
    exit 1
  fi
}

cmd_cert_info() {
  load_env
  cert="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
  if [[ ! -f "$cert" ]]; then
    echo "Certificate not found: $cert"
    exit 1
  fi
  openssl x509 -enddate -startdate -noout -in "$cert"
}

cmd_disk_usage() {
  echo "=== Filesystem ==="
  df -h / /data 2>/dev/null || true
  echo ""
  echo "=== Backups ==="
  du -sh /root/backups/* 2>/dev/null | sort -rh | head -20 || true
  echo ""
  echo "=== MinIO ==="
  du -sh /data/minio 2>/dev/null || true
  echo ""
  echo "=== Logs ==="
  du -sh /var/log/nginx /var/log/prosody /var/log/conjiweb-backup.log 2>/dev/null || true
}

cmd_top_requests() {
  local log="/var/log/nginx/access.log"
  if [[ ! -f "$log" ]]; then
    echo "Log not found: $log"
    exit 1
  fi
  echo "=== Top 30 paths (last 10000 lines) ==="
  tail -n 10000 "$log" | awk '{print $7}' | cut -d'?' -f1 | sort | uniq -c | sort -rn | head -30
}

cmd_ports() {
  echo "=== Listening ports ==="
  ss -tulpen 2>/dev/null || netstat -tulpen 2>/dev/null || true
}

cmd_backup_verify() {
  local latest
  latest="$(ls -1t /root/backups/db_*.sql.gz 2>/dev/null | head -n1 || true)"
  if [[ -z "${latest}" ]]; then
    echo "No backup archive found under /root/backups"
    exit 1
  fi
  echo "Verifying: ${latest}"
  if gzip -t "${latest}"; then
    echo "Backup archive is valid"
  else
    echo "Backup archive is corrupted"
    exit 1
  fi
}

cmd_env_check() {
  load_env
  local failed=0
  for key in DOMAIN EMAIL XMPP_DOMAIN DB_PASS REDIS_PASS SECRET_KEY MINIO_ROOT_PASSWORD ADMIN_PASS PUBLIC_DOMAIN; do
    value="$(eval "printf '%s' \"\${$key:-}\"")"
    if [[ -z "${value}" ]]; then
      echo "MISSING: ${key}"
      failed=1
    else
      echo "OK: ${key}"
    fi
  done
  [[ "${failed}" -eq 0 ]] || exit 1
}

cmd_watchdog() {
  if [[ -x /usr/local/bin/conjiweb-alert.sh ]]; then
    /usr/local/bin/conjiweb-alert.sh
    echo "watchdog executed"
  else
    echo "watchdog script not found: /usr/local/bin/conjiweb-alert.sh"
    exit 1
  fi
}

case "${1:-}" in
  status)          cmd_status ;;
  start)           cmd_start ;;
  stop)            cmd_stop ;;
  restart)         cmd_restart ;;
  restart-api)     systemctl restart conjiweb-api ;;
  restart-nginx)   systemctl reload nginx ;;
  logs-api)        journalctl -u conjiweb-api -f ;;
  logs-xmpp)       tail -f /var/log/prosody/prosody.log ;;
  logs-nginx)      tail -f /var/log/nginx/access.log ;;
  logs-nginx-err)  tail -f /var/log/nginx/error.log ;;
  add-user)        cmd_add_user ;;
  del-user)        cmd_del_user ;;
  list-users)      cmd_list_users ;;
  change-pass)     cmd_change_pass ;;
  backup)          /usr/local/bin/conjiweb-backup.sh ;;
  update)          cmd_update_all ;;
  update-front)    cmd_update_front ;;
  update-api)      cmd_update_api ;;
  ssl-renew)       cmd_ssl_renew ;;
  db-shell)        cmd_db_shell ;;
  db-history)      cmd_db_history ;;
  db-rollback)     cmd_db_rollback ;;
  check)           cmd_check ;;
  api-health)      cmd_api_health ;;
  cert-info)       cmd_cert_info ;;
  disk-usage)      cmd_disk_usage ;;
  ports)           cmd_ports ;;
  backup-verify)   cmd_backup_verify ;;
  env-check)       cmd_env_check ;;
  top-requests)    cmd_top_requests ;;
  mem-usage)       cmd_mem_usage ;;
  watchdog)        cmd_watchdog ;;
  *)               usage ;;
esac
