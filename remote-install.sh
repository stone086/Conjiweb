#!/usr/bin/env bash
set -euo pipefail

echo "[WARN] remote-install.sh 已废弃，请改用 install.sh"
exec bash install.sh "$@"
