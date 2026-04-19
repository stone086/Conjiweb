#!/usr/bin/env bash
set -euo pipefail

APP_USER="${APP_USER:-conjiweb}"
INSTALL_DIR="${INSTALL_DIR:-/opt/conjiweb}"
SRC_DIR="${SRC_DIR:-/opt/conjiweb-src}"

echo "This will remove Conjiweb services and local data."
read -r -p "Type YES to continue: " confirm
[[ "$confirm" == "YES" ]] || { echo "Canceled."; exit 1; }

systemctl stop conjiweb-api minio prosody nginx redis-server postgresql 2>/dev/null || true
systemctl disable conjiweb-api minio 2>/dev/null || true

rm -f /etc/systemd/system/conjiweb-api.service
rm -f /etc/systemd/system/minio.service
systemctl daemon-reload

if id -u postgres >/dev/null 2>&1; then
  sudo -u postgres psql -c "DROP DATABASE IF EXISTS \"${APP_USER}\";" || true
  sudo -u postgres psql -c "DROP ROLE IF EXISTS \"${APP_USER}\";" || true
fi

rm -rf "${INSTALL_DIR}" "${SRC_DIR}" /data/minio
rm -f /etc/nginx/sites-enabled/conjiweb
rm -f /etc/nginx/sites-available/conjiweb
rm -f /etc/nginx/conf.d/conjiweb-rate-limit.conf
rm -f /etc/cron.d/conjiweb-backup /etc/cron.d/conjiweb-alert
rm -f /usr/local/bin/conjiweb-backup.sh /usr/local/bin/conjiweb-check /usr/local/bin/conjiweb-alert.sh
rm -f /etc/logrotate.d/conjiweb
rm -f /etc/systemd/journald.conf.d/conjiweb.conf

nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
systemctl restart systemd-journald 2>/dev/null || true

echo "Conjiweb uninstall completed."
