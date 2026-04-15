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
  echo "  mem-usage       Show process memory usage"
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
cmd_stop() { for svc in nginx conjiweb-api minio prosody redis-server postgresql; do systemctl stop "$svc" 2>/dev/null || true; done; }
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
  mkdir -p "${INSTALL_DIR}/web"
  cp -r "${SRC_DIR}/apps/web/." "${INSTALL_DIR}/web/"
  cd "${INSTALL_DIR}/web"

  if [[ -n "${DOMAIN:-}" ]]; then
    cat > .env.production <<EOF
VITE_API_URL=https://${DOMAIN}
VITE_XMPP_WS_URL=wss://${DOMAIN}/xmpp-websocket
EOF
  fi

  if [[ -f package-lock.json ]]; then
    npm ci --silent
  else
    npm install --silent --no-audit --no-fund
  fi
  npm run build
  systemctl reload nginx
  echo -e "${GREEN}Frontend updated${NC}"
}

cmd_update_api() {
  mkdir -p "${INSTALL_DIR}/api"
  cp -r "${SRC_DIR}/apps/api/." "${INSTALL_DIR}/api/"
  cd "${INSTALL_DIR}/api"

  if [[ ! -d .venv ]]; then
    python3.11 -m venv .venv
  fi
  .venv/bin/pip install -q --upgrade pip
  .venv/bin/pip install -q -r requirements.txt

  if [[ -f .env && -f alembic.ini ]]; then
    db_url="$(grep '^DATABASE_URL=' .env | cut -d= -f2- || true)"
    if [[ -n "${db_url}" ]]; then
      sed -i "s|^sqlalchemy.url = .*|sqlalchemy.url = ${db_url}|" alembic.ini
    fi
  fi
  .venv/bin/alembic upgrade head
  systemctl restart conjiweb-api
  echo -e "${GREEN}API updated${NC}"
}

cmd_update_all() {
  echo -e "${CYAN}[1/4] Pull source${NC}"
  cd "${SRC_DIR}"
  git fetch --all --prune
  git reset --hard origin/main

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
  sudo -u postgres psql conjiweb
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
  mem-usage)       cmd_mem_usage ;;
  *)               usage ;;
esac

