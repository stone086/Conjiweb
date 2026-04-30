# Conjiweb

Conjiweb is a web XMPP client/server project with an OMEMO-focused roadmap.
This repository contains the production app plus the 2.0 migration work.

## Status

- Active branch: `2.0` architecture migration on top of the existing deployable stack.
- Current package version: `2.0.0-alpha.1` (see [package.json](/C:/Users/Stone/Documents/github/web_Conji_native/package.json)).
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

Please read [CONTRIBUTING.md](/C:/Users/Stone/Documents/github/web_Conji_native/CONTRIBUTING.md).

## License

See [LICENSE](/C:/Users/Stone/Documents/github/web_Conji_native/LICENSE).

