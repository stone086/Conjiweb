# Conjiweb

Conjiweb is a web XMPP client/server project with an OMEMO-focused roadmap.
This repository contains the production app, deployment automation, and staging
validation evidence for the current release line.

## Status

- Active branch: `main`.
- Current package version: `2.3.5` (see [package.json](package.json) and [VERSION](VERSION)).
- Staging validation: 10/10 deployment-plan steps completed for 2.3.5.
- Frontend source of truth: `apps/web`
- Backend API source: `apps/api`

## Repository Layout

```text
apps/
  api/                     FastAPI backend
  web/                     Frontend app (Vite + React)
configs/                   Service and deployment configs
docs/                      Operations and architecture notes
packages/                  Shared/local packages
plugins/                   Optional plugin modules
scripts/                   Utility scripts (checks, helpers)
install.sh                 Server install script
manage.sh                  Server management/update script
```

## Key Features

- XMPP messaging (private chat + group chat)
- OMEMO encryption flow (ongoing 2.0 migration)
- Message history (MAM), typing state, reactions, reply/edit/retract flows
- File upload and voice attachment flow
- Plugin host integration

## Quick Start (Local Development)

### Requirements

- Node.js 20+ recommended
- npm 10+

### Install

```bash
npm run install:web
```

### Run Dev Server

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Tests / Checks

```bash
npm run test
npm run check:buttons
npm run check
```

## Install and Update Commands

### 1) First-Time Server Installation (Linux host)

Run on the target server:

```bash
cd /opt
git clone https://github.com/stone086/Conjiweb.git conjiweb-src
cd conjiweb-src
chmod +x install.sh manage.sh
sudo ./install.sh
```

The 2.3.5 staging validation includes a full fresh-install rerun using
`bash install.sh`. The install path was corrected for Ubuntu 22.04 / Python
3.10 compatible dependency hashes.

### 2) Routine Server Update (single host)

Run on the server where Conjiweb is installed:

```bash
cd /opt/conjiweb-src
git fetch --prune origin
git reset --hard origin/main
sudo /opt/conjiweb/manage.sh update-api
sudo /opt/conjiweb/manage.sh update-frontend
sudo systemctl restart conjiweb-api
```

## Release Validation

The 2.3.5 staging pass completed all 10 planned validation steps, including:

- Full fresh installation with `bash install.sh`
- Health checks for PostgreSQL, Redis, MinIO, Prosody, Coturn, API, Nginx,
  Prometheus, and Alertmanager
- Browser compatibility evidence
- Backup/restore drill evidence
- Performance baseline evidence
- Evidence gate validation

Primary release report:
[docs/release/2.3.5-validation-report.md](docs/release/2.3.5-validation-report.md)

Install evidence:
[docs/evidence/install/staging-install-results.md](docs/evidence/install/staging-install-results.md)

## Production Notes

- Use `install.sh` for initial server setup.
- Use `manage.sh` for day-2 operations (API/frontend update, service lifecycle).
- Nginx + Prosody + API must be aligned to the same deployed commit for stable behavior.

## OMEMO 2.0 Migration Direction

The migration goal is to move encryption/decryption responsibilities to the new 2.0 path while keeping deployment stability:

1. Route outgoing encryption through the 2.0 core path.
2. Route incoming decryption through the 2.0 core path.
3. Keep compatibility layers until feature parity and interoperability are validated.

Related notes are in the `docs/` folder and `MIGRATION_2.0_README.txt`.

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md).

## License

See [LICENSE](LICENSE).
