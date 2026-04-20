# Changelog

## [1.1.0] - 2026-04-20
### Added
- Search-to-message jump with highlight (`mid` query support)
- Failed message retry flow in chat bubbles
- Delivery/read receipt handling for direct chats
- Reconnect state indicator in top navigation
- Runtime AI provider integration through configurable OpenAI-compatible endpoint
- Group invite inline panel (replacing browser prompt)
- Emoji picker integration in chat composer
- Composer draft persistence per conversation
- Message density setting wired to actual chat rendering
- Runtime caching strategy in Vite PWA build
- CI workflow split for web build and API tests
- Script syntax checks in CI (`install.sh`, `manage.sh`, `uninstall.sh`)
- Unified runtime version reader for API (`app/core/version.py`)
- New `manage.sh` commands: `api-health`, `ports`, `backup-verify`, `env-check`
- Nginx `/api/redoc` proxy route

### Changed
- Manual chunking for frontend build to reduce initial bundle pressure
- Plugin permissions UI now renders backend-provided permissions
- Account removal now clears local chat/roster/draft state consistently
- API update flow preserves operator-managed Alembic URL when already customized

### Fixed
- Mobile contact actions visibility and usability regressions
- Notification/admin token expiry handling in admin UI
- MAM timestamp parsing and timeout safety paths
- Default backup database name resolution with `APP_USER`
- Removed mutable default containers in SQLAlchemy models/migration
- Migrated Pydantic config to V2 style (`ConfigDict` / `SettingsConfigDict`)
- Replaced deprecated UTC usage (`datetime.now(UTC)`)

## [1.0.0] - 2026-04-19
### Added
- Native VPS installer (`install.sh`)
- FastAPI backend + React frontend deployment flow
- Prosody + MinIO + PostgreSQL + Redis integration
- UFW + fail2ban baseline hardening
- `manage.sh` operational command suite
- Health endpoint (`/api/health`)
- API login/register rate limiting
- Backup verification and optional remote sync (`BACKUP_REMOTE`)
- Logrotate + journald quota setup
- Service watchdog script (`conjiweb-alert.sh`)
