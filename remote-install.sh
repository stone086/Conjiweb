#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bash remote-install.sh --repo <github_repo_url> --domain <your_domain> --email <your_email> [options]

Required:
  --repo      Git repository URL, for example: https://github.com/you/web-gajim-v3-native.git
  --domain    Public domain, for example: chat.example.com
  --email     Email for Let's Encrypt certificate notices

Optional:
  --branch    Git branch to install from (default: main)
  --path      Project path inside repo; auto-detected if omitted
  --target    Clone target directory (default: /opt/web-gajim-v3-src)
  --help      Show this help

Example:
  bash remote-install.sh \
    --repo https://github.com/you/web-gajim-v3-native.git \
    --domain chat.example.com \
    --email you@example.com
EOF
}

REPO_URL=""
DOMAIN=""
EMAIL=""
BRANCH="main"
PROJECT_PATH=""
TARGET_DIR="/opt/web-gajim-v3-src"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO_URL="${2:-}"; shift 2 ;;
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --email) EMAIL="${2:-}"; shift 2 ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --path) PROJECT_PATH="${2:-}"; shift 2 ;;
    --target) TARGET_DIR="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

[[ -n "$REPO_URL" ]] || { echo "[ERR] --repo is required"; usage; exit 1; }
[[ -n "$DOMAIN" ]] || { echo "[ERR] --domain is required"; usage; exit 1; }
[[ -n "$EMAIL" ]] || { echo "[ERR] --email is required"; usage; exit 1; }
[[ "$(id -u)" -eq 0 ]] || { echo "[ERR] Please run as root"; exit 1; }

echo "[INFO] Preparing dependencies..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git ca-certificates

if [[ -d "$TARGET_DIR/.git" ]]; then
  echo "[INFO] Existing source detected, refreshing: $TARGET_DIR"
  git -C "$TARGET_DIR" fetch --all --prune
  git -C "$TARGET_DIR" reset --hard "origin/$BRANCH"
else
  echo "[INFO] Cloning $REPO_URL ($BRANCH) into $TARGET_DIR"
  rm -rf "$TARGET_DIR"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$TARGET_DIR"
fi

if [[ -n "$PROJECT_PATH" ]]; then
  INSTALL_DIR="$TARGET_DIR/$PROJECT_PATH"
elif [[ -f "$TARGET_DIR/install.sh" ]]; then
  INSTALL_DIR="$TARGET_DIR"
elif [[ -f "$TARGET_DIR/web_Conji_native/install.sh" ]]; then
  INSTALL_DIR="$TARGET_DIR/web_Conji_native"
else
  echo "[ERR] Cannot find install.sh. Use --path to specify project directory inside repo."
  exit 1
fi

cd "$INSTALL_DIR"
[[ -f ".env.example" ]] || { echo "[ERR] .env.example not found in $INSTALL_DIR"; exit 1; }
[[ -f "install.sh" ]] || { echo "[ERR] install.sh not found in $INSTALL_DIR"; exit 1; }

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
if grep -qE '^XMPP_DOMAIN=' .env && [[ -z "$(grep -E '^XMPP_DOMAIN=' .env | head -n1 | cut -d= -f2-)" ]]; then
  set_env "XMPP_DOMAIN" "$DOMAIN"
fi

chmod +x install.sh manage.sh
echo "[INFO] Starting native install in $INSTALL_DIR"
bash install.sh
echo "[OK] Install finished."
