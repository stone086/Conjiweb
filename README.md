# Conjiweb (Native)

Conjiweb is a self-hosted Web XMPP platform for VPS deployment without Docker.

## Features
- One-command native install on Debian 12
- Web chat client (React + Vite + TypeScript)
- FastAPI backend with admin token auth and health endpoints
- Prosody XMPP server with WebSocket bridge
- PostgreSQL + Redis + MinIO integration
- HTTPS by default (Let's Encrypt + Nginx)
- Security baseline (UFW, fail2ban, API rate limiting)
- Built-in backup, watchdog, and operational commands

## Tech Stack
- Frontend: React, Vite, TypeScript
- Backend: FastAPI, SQLAlchemy, Python 3.11+
- Realtime: Prosody (XMPP)
- Data: PostgreSQL 16, Redis 7
- Storage: MinIO
- Reverse Proxy: Nginx + Certbot

## Requirements
- Debian 12 VPS (recommended)
- Root shell access
- Domain pointed to your VPS public IP
- Open inbound ports: `80`, `443` (plus XMPP ports as required)

## Quick Install
```bash
curl -fsSL https://raw.githubusercontent.com/stone086/Conjiweb/main/install.sh | \
bash -s -- --repo https://github.com/stone086/Conjiweb.git --domain chat.example.com --email you@example.com
```

Alternative local bootstrap:
```bash
git clone https://github.com/stone086/Conjiweb.git /opt/conjiweb-src
cd /opt/conjiweb-src
cp .env.example .env
bash install.sh
```

## Architecture
- Internet -> Nginx (`443`)
- Nginx -> FastAPI (`127.0.0.1:8000`) for `/api/*`
- Nginx -> Prosody (`127.0.0.1:5280`) for `/xmpp-websocket`
- Nginx -> MinIO (`127.0.0.1:9000`) for `/files/*`
- FastAPI -> PostgreSQL + Redis

See detailed topology: [`docs/architecture.md`](docs/architecture.md)

## Security Baseline
- UFW allow-list with SSH port auto-detection
- Optional SSH port hardening and SSH key setup during install
- fail2ban for SSH and API login endpoints
- Non-root runtime users for API and MinIO
- API auth rate-limit in FastAPI and Nginx
- Secrets file written once to `/root/conjiweb-secrets.txt` (`0600`)
- `.env` permission hardening (`0600`) and backup folder (`0700`)

## Daily Operations
```bash
cd /opt/conjiweb-src
bash manage.sh status
bash manage.sh update
bash manage.sh check
bash manage.sh logs-api
```

### Manage Command Reference
- Service: `status`, `start`, `stop`, `restart`, `restart-api`, `restart-nginx`
- Logs: `logs-api`, `logs-xmpp`, `logs-nginx`, `logs-nginx-err`
- XMPP: `add-user`, `del-user`, `list-users`, `change-pass`
- Ops: `backup`, `update`, `update-front`, `update-api`, `ssl-renew`, `db-shell`
- Migrations: `db-history`, `db-rollback`
- Inspect: `check`, `api-health`, `cert-info`, `disk-usage`, `ports`, `backup-verify`, `env-check`, `top-requests`, `mem-usage`, `watchdog`

## Health, API Docs, and Validation
- API health: `https://<domain>/api/health`
- API docs (Swagger): `https://<domain>/api/docs`
- Redoc: `https://<domain>/api/redoc` (if enabled)
- Quick service check: `bash manage.sh check`

## Backups
- Local daily cron backup: `/usr/local/bin/conjiweb-backup.sh`
- Local target: `/root/backups`
- DB backup integrity verification built-in (`gzip -t`)
- Optional offsite sync via `BACKUP_REMOTE` (`rclone copy`)

## Upgrade Strategy
- Source-of-truth update:
```bash
cd /opt/conjiweb-src
bash manage.sh update
```
- Frontend only:
```bash
bash manage.sh update-front
```
- API only:
```bash
bash manage.sh update-api
```

## Documentation Index
- Architecture: [`docs/architecture.md`](docs/architecture.md)
- Registration flow: [`docs/registration-flow.md`](docs/registration-flow.md)
- XMPP config: [`docs/xmpp-config.md`](docs/xmpp-config.md)
- Troubleshooting: [`docs/troubleshooting.md`](docs/troubleshooting.md)

## Versioning
- Current version: [`VERSION`](VERSION)
- Release notes: [`CHANGELOG.md`](CHANGELOG.md)

## Contributing
Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening PRs.

## Uninstall
```bash
cd /opt/conjiweb-src
bash uninstall.sh
```

## License
MIT, see [`LICENSE`](LICENSE).
