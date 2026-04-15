#!/usr/bin/env bash
# =============================================================================
#  Conjiweb 鈥?绠＄悊鑴氭湰
#  鐢ㄦ硶: bash manage.sh [鍛戒护]
# =============================================================================

INSTALL_DIR="/opt/conjiweb"
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; NC='\033[0m'

usage() {
  echo -e "${CYAN}Conjiweb 绠＄悊鑴氭湰${NC}"
  echo ""
  echo "鐢ㄦ硶: bash manage.sh [鍛戒护]"
  echo ""
  echo "鏈嶅姟绠＄悊:"
  echo "  status          鏌ョ湅鎵€鏈夋湇鍔＄姸鎬?
  echo "  start           鍚姩鎵€鏈夋湇鍔?
  echo "  stop            鍋滄鎵€鏈夋湇鍔?
  echo "  restart         閲嶅惎鎵€鏈夋湇鍔?
  echo "  restart-api     鍙噸鍚悗绔?API"
  echo "  restart-nginx   鍙噸鍚?Nginx"
  echo ""
  echo "鏃ュ織:"
  echo "  logs-api        鏌ョ湅 API 瀹炴椂鏃ュ織"
  echo "  logs-xmpp       鏌ョ湅 Prosody 鏃ュ織"
  echo "  logs-nginx      鏌ョ湅 Nginx 璁块棶鏃ュ織"
  echo "  logs-nginx-err  鏌ョ湅 Nginx 閿欒鏃ュ織"
  echo ""
  echo "XMPP 鐢ㄦ埛:"
  echo "  add-user        娣诲姞 XMPP 鐢ㄦ埛"
  echo "  del-user        鍒犻櫎 XMPP 鐢ㄦ埛"
  echo "  list-users      鍒楀嚭鎵€鏈夌敤鎴?
  echo "  change-pass     淇敼鐢ㄦ埛瀵嗙爜"
  echo ""
  echo "缁存姢:"
  echo "  backup          绔嬪嵆澶囦唤"
  echo "  update-front    鏇存柊鍓嶇锛堥噸鏂版瀯寤猴級"
  echo "  update-api      鏇存柊鍚庣锛堥噸鍚湇鍔★級"
  echo "  ssl-renew       鎵嬪姩缁湡 SSL 璇佷功"
  echo "  db-shell        杩涘叆鏁版嵁搴撳懡浠よ"
  echo "  mem-usage       鏌ョ湅鍐呭瓨浣跨敤"
}

SERVICES=("postgresql" "redis-server" "prosody" "minio" "conjiweb-api" "nginx")

cmd_status() {
  echo -e "\n${CYAN}鈹佲攣鈹?鏈嶅姟鐘舵€?鈹佲攣鈹?{NC}"
  for svc in "${SERVICES[@]}"; do
    STATUS=$(systemctl is-active "$svc" 2>/dev/null || echo "unknown")
    if [ "$STATUS" = "active" ]; then
      echo -e "  ${GREEN}鈼?{NC} $svc"
    else
      echo -e "  ${RED}鈼?{NC} $svc (${STATUS})"
    fi
  done

  echo -e "\n${CYAN}鈹佲攣鈹?鍐呭瓨浣跨敤 鈹佲攣鈹?{NC}"
  free -h | grep -E "^(Mem|Swap)"

  echo -e "\n${CYAN}鈹佲攣鈹?纾佺洏浣跨敤 鈹佲攣鈹?{NC}"
  df -h / /data 2>/dev/null | tail -n +1
  echo ""
}

cmd_start() {
  for svc in "${SERVICES[@]}"; do
    systemctl start "$svc" && echo -e "${GREEN}[OK]${NC} $svc" || echo -e "${RED}[FAIL]${NC} $svc"
  done
}

cmd_stop() {
  for svc in $(echo "${SERVICES[@]}" | tr ' ' '\n' | tac); do
    systemctl stop "$svc" && echo -e "${GREEN}[OK]${NC} stopped $svc"
  done
}

cmd_restart() {
  for svc in "${SERVICES[@]}"; do
    systemctl restart "$svc" && echo -e "${GREEN}[OK]${NC} restarted $svc"
  done
}

cmd_add_user() {
  source .env 2>/dev/null || true
  DOMAIN="${XMPP_DOMAIN:-localhost}"
  read -rp "鐢ㄦ埛鍚? " USERNAME
  prosodyctl adduser "${USERNAME}@${DOMAIN}"
  echo -e "${GREEN}鐢ㄦ埛 ${USERNAME}@${DOMAIN} 宸插垱寤?{NC}"
}

cmd_del_user() {
  source .env 2>/dev/null || true
  DOMAIN="${XMPP_DOMAIN:-localhost}"
  read -rp "瑕佸垹闄ょ殑鐢ㄦ埛鍚? " USERNAME
  prosodyctl deluser "${USERNAME}@${DOMAIN}"
  echo -e "${YELLOW}鐢ㄦ埛 ${USERNAME}@${DOMAIN} 宸插垹闄?{NC}"
}

cmd_list_users() {
  source .env 2>/dev/null || true
  DOMAIN="${XMPP_DOMAIN:-localhost}"
  prosodyctl list users "${DOMAIN}"
}

cmd_change_pass() {
  source .env 2>/dev/null || true
  DOMAIN="${XMPP_DOMAIN:-localhost}"
  read -rp "鐢ㄦ埛鍚? " USERNAME
  prosodyctl passwd "${USERNAME}@${DOMAIN}"
}

cmd_update_front() {
  echo "閲嶆柊鏋勫缓鍓嶇..."
  cd "${INSTALL_DIR}/web"
  git pull 2>/dev/null || true
  npm ci --silent
  npm run build
  echo -e "${GREEN}鍓嶇鏇存柊瀹屾垚${NC}"
  systemctl reload nginx
}

cmd_update_api() {
  echo "鏇存柊鍚庣..."
  cd "${INSTALL_DIR}/api"
  git pull 2>/dev/null || true
  .venv/bin/pip install -q -r requirements.txt
  .venv/bin/alembic upgrade head
  systemctl restart conjiweb-api
  echo -e "${GREEN}鍚庣鏇存柊瀹屾垚${NC}"
}

cmd_mem_usage() {
  echo -e "${CYAN}鈹佲攣鈹?杩涚▼鍐呭瓨浣跨敤 鈹佲攣鈹?{NC}"
  ps aux --sort=-%mem | grep -E "(postgres|redis|prosody|minio|uvicorn|nginx)" | \
    awk '{printf "%-30s %s MB\n", $11, int($6/1024)}'
  echo ""
  free -h
}

cmd_ssl_renew() {
  certbot renew --nginx
  systemctl reload nginx
  echo -e "${GREEN}SSL 璇佷功缁湡瀹屾垚${NC}"
}

cmd_db_shell() {
  sudo -u postgres psql conjiweb
}

case "${1:-}" in
  status)       cmd_status ;;
  start)        cmd_start ;;
  stop)         cmd_stop ;;
  restart)      cmd_restart ;;
  restart-api)  systemctl restart conjiweb-api && echo "API 閲嶅惎瀹屾垚" ;;
  restart-nginx) systemctl reload nginx && echo "Nginx 閲嶈浇瀹屾垚" ;;
  logs-api)     journalctl -u conjiweb-api -f ;;
  logs-xmpp)    tail -f /var/log/prosody/prosody.log ;;
  logs-nginx)   tail -f /var/log/nginx/access.log ;;
  logs-nginx-err) tail -f /var/log/nginx/error.log ;;
  add-user)     cmd_add_user ;;
  del-user)     cmd_del_user ;;
  list-users)   cmd_list_users ;;
  change-pass)  cmd_change_pass ;;
  backup)       /usr/local/bin/conjiweb-backup.sh ;;
  update-front) cmd_update_front ;;
  update-api)   cmd_update_api ;;
  ssl-renew)    cmd_ssl_renew ;;
  db-shell)     cmd_db_shell ;;
  mem-usage)    cmd_mem_usage ;;
  *)            usage ;;
esac
