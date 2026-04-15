#!/usr/bin/env bash
# =============================================================================
#  Web Gajim V3 — 管理脚本
#  用法: bash manage.sh [命令]
# =============================================================================

INSTALL_DIR="/opt/web-gajim-v3"
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; NC='\033[0m'

usage() {
  echo -e "${CYAN}Web Gajim V3 管理脚本${NC}"
  echo ""
  echo "用法: bash manage.sh [命令]"
  echo ""
  echo "服务管理:"
  echo "  status          查看所有服务状态"
  echo "  start           启动所有服务"
  echo "  stop            停止所有服务"
  echo "  restart         重启所有服务"
  echo "  restart-api     只重启后端 API"
  echo "  restart-nginx   只重启 Nginx"
  echo ""
  echo "日志:"
  echo "  logs-api        查看 API 实时日志"
  echo "  logs-xmpp       查看 Prosody 日志"
  echo "  logs-nginx      查看 Nginx 访问日志"
  echo "  logs-nginx-err  查看 Nginx 错误日志"
  echo ""
  echo "XMPP 用户:"
  echo "  add-user        添加 XMPP 用户"
  echo "  del-user        删除 XMPP 用户"
  echo "  list-users      列出所有用户"
  echo "  change-pass     修改用户密码"
  echo ""
  echo "维护:"
  echo "  backup          立即备份"
  echo "  update-front    更新前端（重新构建）"
  echo "  update-api      更新后端（重启服务）"
  echo "  ssl-renew       手动续期 SSL 证书"
  echo "  db-shell        进入数据库命令行"
  echo "  mem-usage       查看内存使用"
}

SERVICES=("postgresql" "redis-server" "prosody" "minio" "webgajim-api" "nginx")

cmd_status() {
  echo -e "\n${CYAN}━━━ 服务状态 ━━━${NC}"
  for svc in "${SERVICES[@]}"; do
    STATUS=$(systemctl is-active "$svc" 2>/dev/null || echo "unknown")
    if [ "$STATUS" = "active" ]; then
      echo -e "  ${GREEN}●${NC} $svc"
    else
      echo -e "  ${RED}●${NC} $svc (${STATUS})"
    fi
  done

  echo -e "\n${CYAN}━━━ 内存使用 ━━━${NC}"
  free -h | grep -E "^(Mem|Swap)"

  echo -e "\n${CYAN}━━━ 磁盘使用 ━━━${NC}"
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
  read -rp "用户名: " USERNAME
  prosodyctl adduser "${USERNAME}@${DOMAIN}"
  echo -e "${GREEN}用户 ${USERNAME}@${DOMAIN} 已创建${NC}"
}

cmd_del_user() {
  source .env 2>/dev/null || true
  DOMAIN="${XMPP_DOMAIN:-localhost}"
  read -rp "要删除的用户名: " USERNAME
  prosodyctl deluser "${USERNAME}@${DOMAIN}"
  echo -e "${YELLOW}用户 ${USERNAME}@${DOMAIN} 已删除${NC}"
}

cmd_list_users() {
  source .env 2>/dev/null || true
  DOMAIN="${XMPP_DOMAIN:-localhost}"
  prosodyctl list users "${DOMAIN}"
}

cmd_change_pass() {
  source .env 2>/dev/null || true
  DOMAIN="${XMPP_DOMAIN:-localhost}"
  read -rp "用户名: " USERNAME
  prosodyctl passwd "${USERNAME}@${DOMAIN}"
}

cmd_update_front() {
  echo "重新构建前端..."
  cd "${INSTALL_DIR}/web"
  git pull 2>/dev/null || true
  npm ci --silent
  npm run build
  echo -e "${GREEN}前端更新完成${NC}"
  systemctl reload nginx
}

cmd_update_api() {
  echo "更新后端..."
  cd "${INSTALL_DIR}/api"
  git pull 2>/dev/null || true
  .venv/bin/pip install -q -r requirements.txt
  .venv/bin/alembic upgrade head
  systemctl restart webgajim-api
  echo -e "${GREEN}后端更新完成${NC}"
}

cmd_mem_usage() {
  echo -e "${CYAN}━━━ 进程内存使用 ━━━${NC}"
  ps aux --sort=-%mem | grep -E "(postgres|redis|prosody|minio|uvicorn|nginx)" | \
    awk '{printf "%-30s %s MB\n", $11, int($6/1024)}'
  echo ""
  free -h
}

cmd_ssl_renew() {
  certbot renew --nginx
  systemctl reload nginx
  echo -e "${GREEN}SSL 证书续期完成${NC}"
}

cmd_db_shell() {
  sudo -u postgres psql webgajim
}

case "${1:-}" in
  status)       cmd_status ;;
  start)        cmd_start ;;
  stop)         cmd_stop ;;
  restart)      cmd_restart ;;
  restart-api)  systemctl restart webgajim-api && echo "API 重启完成" ;;
  restart-nginx) systemctl reload nginx && echo "Nginx 重载完成" ;;
  logs-api)     journalctl -u webgajim-api -f ;;
  logs-xmpp)    tail -f /var/log/prosody/prosody.log ;;
  logs-nginx)   tail -f /var/log/nginx/access.log ;;
  logs-nginx-err) tail -f /var/log/nginx/error.log ;;
  add-user)     cmd_add_user ;;
  del-user)     cmd_del_user ;;
  list-users)   cmd_list_users ;;
  change-pass)  cmd_change_pass ;;
  backup)       /usr/local/bin/webgajim-backup.sh ;;
  update-front) cmd_update_front ;;
  update-api)   cmd_update_api ;;
  ssl-renew)    cmd_ssl_renew ;;
  db-shell)     cmd_db_shell ;;
  mem-usage)    cmd_mem_usage ;;
  *)            usage ;;
esac
