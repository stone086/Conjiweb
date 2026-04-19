# Conjiweb (Native)

Conjiweb is a self-hosted Web XMPP platform for VPS deployment without Docker.

## Stack
- Frontend: React + Vite + TypeScript
- Backend: FastAPI + Python 3.11
- XMPP: Prosody
- Storage: MinIO
- DB/Cache: PostgreSQL 16 + Redis 7
- Reverse proxy: Nginx + Let's Encrypt

## Requirements
- Debian 12 (recommended)
- Root shell access
- Domain name pointing to your VPS
- Ports: `80`, `443` (and XMPP ports if needed)

## Quick Install
```bash
curl -fsSL https://raw.githubusercontent.com/stone086/Conjiweb/main/install.sh | \
bash -s -- --repo https://github.com/stone086/Conjiweb.git --domain chat.example.com --email you@example.com
```

Or clone and run locally:
```bash
git clone https://github.com/stone086/Conjiweb.git /opt/conjiweb-src
cd /opt/conjiweb-src
cp .env.example .env
bash install.sh
```

## Daily Operations
```bash
cd /opt/conjiweb-src
bash manage.sh status
bash manage.sh update
bash manage.sh logs-api
bash manage.sh check
```

## Manage Commands
- Service: `status`, `start`, `stop`, `restart`, `restart-api`, `restart-nginx`
- Logs: `logs-api`, `logs-xmpp`, `logs-nginx`, `logs-nginx-err`
- XMPP: `add-user`, `del-user`, `list-users`, `change-pass`
- Ops: `backup`, `update`, `update-front`, `update-api`, `ssl-renew`, `db-shell`
- DB/Migrations: `db-history`, `db-rollback`
- Health/Inspect: `check`, `cert-info`, `disk-usage`, `top-requests`, `mem-usage`
- Watchdog: `watchdog`

## Security Hardening Included
- UFW with SSH port auto-detection
- fail2ban for SSH + API login endpoint
- Non-root service users for API/MinIO
- `.env` and secrets file permissions (`600`)
- Backup directory permission (`700`)
- API login rate limit (FastAPI + Nginx layer)

## Backups
- Daily local backups via cron: `/usr/local/bin/conjiweb-backup.sh`
- Local directory: `/root/backups`
- Optional remote sync with `BACKUP_REMOTE` (`rclone`)

## Health Endpoints
- External: `https://<domain>/api/health`
- Internal backend route: `/api/health`

## Docs
- API docs: `https://<domain>/api/docs`
- Troubleshooting: [`docs/troubleshooting.md`](docs/troubleshooting.md)

## Versioning
- Current version file: [`VERSION`](VERSION)
- Changelog: [`CHANGELOG.md`](CHANGELOG.md)

## Contributing
Please read [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Uninstall
```bash
cd /opt/conjiweb-src
bash uninstall.sh
```

## License
MIT, see [`LICENSE`](LICENSE).
