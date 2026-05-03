# Changelog

## [1.6.0] - 2026-05-02 — Hardening, observability, and resource hygiene

A large multi-pass review pass covering security, performance, dependencies,
observability, accessibility, UX, and resource management.

### Security — Authentication & Authorization
- Critical: fixed auth bypass when `prosodyctl check password` is unsupported —
  now falls back to async XMPP SASL PLAIN bind instead of silently allowing login
- Admin password comparison now uses `secrets.compare_digest` (timing attack hardening)
- OIDC `id_token` signature now verified via JWKS (python-jose), not just userinfo
- OIDC callback uses one-time code exchange via Redis (token no longer in URL fragment)
- LDAP login + SSO exchange + AI endpoints + webhook trigger all rate-limited
- Webhook inbound: rate limited 60/min, payload limited
- SSO `_ensure_account` looks up by `(provider, provider_sub)` first, falls back to JID,
  preventing duplicate accounts when display name changes
- `SsoIdentity` model now has `UniqueConstraint(provider, provider_sub)` matching migration
- Filename sanitization on attachment uploads (path stripping + char allowlist)
- Admin token storage moved from `localStorage` to `sessionStorage` (XSS exposure window cut)

### Security — Network & Transport
- SSRF DNS rebinding fix: preview endpoint resolves hostnames and validates the
  returned IP via `ipaddress.ip_address` (private/loopback/link-local/reserved blocked)
- Strict TLS ciphers, `ssl_session_tickets off`, ssl_prefer_server_ciphers
- Added `Permissions-Policy`, `Cross-Origin-Opener-Policy` headers
- CSP: added `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'self'`
- API docs (`/api/docs`, `/redoc`, `/openapi.json`) restricted to localhost in nginx
- Prosody `s2s_secure_auth = true` (verifies federation peer certificates)
- Service Worker validates `event.source` is same-origin before `skipWaiting`
- Service Worker notification click only allows same-origin paths (no open-redirect)
- Service Worker push body length capped (title 100, body 500) to prevent OOM

### Security — Inputs & DoS
- All Pydantic request models now have `Field(min_length, max_length)` constraints
  on every string field (auth, sso, messages, ai, webhooks, accounts, contacts,
  conversations) — prevents memory-DoS via giant request bodies
- Per-element list validation in AI summarize endpoint
- Frontend message textarea has `maxLength={10000}`
- WebSocket: max 10 connections per account, 3-minute idle disconnect

### Security — Dependencies & CVEs
- Backend: python-jose 3.3.0 → 3.4.0 (CVE-2024-33663, CVE-2024-33664)
- Backend: python-multipart 0.0.9 → 0.0.18 (CVE-2024-24762)
- Backend: bumped fastapi/sqlalchemy/pydantic/asyncpg/alembic/pillow to current stable
- Frontend: vite 5.2.13 → 5.4.18 (CVE-2024-45812, CVE-2025-30208, CVE-2025-31125, CVE-2025-32395)
- Frontend: bumped axios, react-router-dom, dexie, lucide-react to current stable
- Vite dev server pinned to `host: "127.0.0.1"`, `fs.strict: true`

### Performance
- Async event loop unblocked in 5 places: `subprocess.run`, `socket.create_connection`,
  `socket.getaddrinfo`, `ldap3.Connection.auto_bind` all wrapped in `asyncio.to_thread`
  or replaced with `asyncio.open_connection` / `loop.getaddrinfo`
- Database: 8 new indexes (alembic 0006_perf_indexes), including composite indexes
  `(account_id, type)` on conversations and `(conversation_id, created_at)` on messages
- preview link cache: bounded to 1000 entries with LRU-style eviction
- AI endpoints: rate-limited (10–30/min by endpoint type)

### Observability
- Structured logging configured in `app.main` (logs to stderr → systemd journal)
- Per-module loggers: `conjiweb.auth`, `conjiweb.sso`, `conjiweb.ai`, `conjiweb.push`, `conjiweb.webhooks`
- Request-ID middleware: generates `X-Request-ID`, echoes in response headers,
  logs slow requests (>1s) and 4xx/5xx with timing
- Global exception middleware catches unhandled errors, returns JSON with request_id
- Auth audit logging: `admin_login_failed`, `admin_login_ok`, `ldap_auth_failed` (with client IP)
- Push notification failures and AI provider errors no longer silently swallowed

### Resource hygiene
- Fixed AudioContext leak in notificationStore (was leaking 6/tab → silent notifications)
- Fixed MediaStream leak in jingle screen-share (camera light staying on)
- Fixed ChatPage `useEffect` listener accumulation (incoming-call listeners doubled per call)
- `JingleSession.on()`, `CallManager.on()`, `GroupCall.on()`, `GroupCallManager.on()`
  now return unsubscribe functions; matching `off()` methods added
- preview link cache: bounded growth (was unlimited memory leak)

### Infrastructure
- Both Dockerfiles rewritten as multi-stage with non-root users + HEALTHCHECK
- Added `.dockerignore` to API and web (prevents `.env` and `.git` leaking into images)
- systemd service hardened with 17 sandboxing directives
  (`NoNewPrivileges`, `ProtectKernel*`, `MemoryDenyWriteExecute`, `SystemCallFilter`, etc.)
- Backup script: AES-256 encryption with PBKDF2 100k iterations
- Backup script: pre-flight disk check, alert email on remote sync failure
- New `manage.sh backup-restore` command for encrypted backup recovery
- `manage.sh backup-verify` fixed to handle encrypted format
- install.sh auto-installs `libldap2-dev libsasl2-dev` when LDAP enabled

### CI / CD
- CI: ShellCheck, `tsc --noEmit` typecheck, `npm audit`, `pip-audit`, CodeQL scans
- CI: minimum permissions (`contents: read`)
- Deploy: concurrency control, `environment: production` for required reviewers,
  `command_timeout` to prevent SSH hangs

### Code quality
- Removed UTF-8 BOM from 18 source files
- Converted CRLF to LF in 13 files
- Removed `console.log("TOKEN STORED:", token)` (admin JWT was leaking to browser console)
- Demoted other `console.log` to `console.debug`
- AST-scanned all Python for blocking-IO-in-async; all clean
- Removed dead OMEMO code (omemo2/, core/omemo/, adapters/) — production runs only
  `services/omemo/` + `services/e2ee.ts` with libsignal + legacy `axolotl` namespace fallback

### Accessibility & UX
- All password inputs: `autoComplete="current-password|new-password"`, `spellCheck={false}`
  — prevents Chrome enhanced-spellcheck from uploading passwords to cloud
- All username/JID inputs: `autoCapitalize="none"`, `autoCorrect="off"`
- Icon-only call/close buttons: added `aria-label` and `title`
- Replaced native `alert()` in GlobalSearch RAG with `react-hot-toast` (loading + success + error)
- Added i18n keys for new UX strings (English + Chinese)

### Test coverage
- New tests: `test_ai.py`, `test_webhooks.py`, `test_metrics.py`
- SSO tests expanded: code exchange, JID collision, sanitizer, provider labels

### Privacy
- README: removed Windows path leak `/C:/Users/Stone/Documents/...`
- README: version bumped to current

### Configuration
- All SSO/LDAP/VAPID/PUSH config moved to pydantic Settings (zero `os.getenv` in routers)
- `.env.example` documents all 30+ Settings fields with usage hints
- Removed unused `LDAP_USER_BASE` field

### Frontend feature wiring
- Discovery page (`/discovery`) with public group directory + server health
- Meta-contacts UI: "Merge contact" button in RightPanel
- RAG "Ask AI" button in GlobalSearch
- GroupCallView fully integrated into ChatPage with event-driven lifecycle

### Database
- New table `sso_identities` (alembic 0005) with `(provider, provider_sub)` unique constraint
- 8 new indexes (alembic 0006) for high-traffic FK columns and common composite filters

---

## [1.5.1] - 2026-05-01 — Security hardening + code quality

### Fixed (P0 — runtime errors)
- RAG endpoint ImportError: `async_session` was not exported from database.py
- SSO (OIDC/LDAP) account creation missing required `domain` field → NOT NULL crash
- SSO account creation missing `AccountPreference` → downstream null-ref errors

### Fixed (Security)
- OIDC callback no longer exposes JWT in URL fragment; uses one-time code exchange via Redis
- OIDC id_token signature now verified via JWKS (python-jose), with userinfo fallback
- LDAP login endpoint now has `@limiter.limit("10/minute")` rate limiting
- OIDC JID generation uses `sub` claim hash to prevent display-name collisions
- RAG endpoint now requires user token (scoped to own account), not just admin token
- Web Vitals metrics endpoint now rate-limited (30/min) to prevent spam
- Conversation insight endpoint removed `response_format: json_object` for provider compat

### Fixed (Architecture)
- OIDC CSRF state moved from in-memory dict to Redis (multi-worker safe, auto-expiring)
- All SSO/LDAP/VAPID config consolidated into `app.core.config.Settings` (pydantic-settings)
- SSO router no longer uses raw `os.getenv()` — reads from `settings.*`
- Push router VAPID keys read from `settings.VAPID_*` instead of `os.getenv()`
- AI router imports (`json`, `re`, models) moved to file top level
- Deleted dead OMEMO code: omemo2/ (461 lines), core/omemo/engine.ts (217 lines), adapters/ (unused)
- Only production OMEMO remains: `services/omemo/` + `services/e2ee.ts` (libsignal + legacy fallback)
- Removed obsolete migration docs (MIGRATION_2.0_README.txt, docs/conjiweb-2.0/)
- Root package.json renamed to `conjiweb-monorepo`, version synced to 1.5.1

### Fixed (Code quality)
- Removed UTF-8 BOM from 18 source files (Python, TypeScript, Markdown)
- Converted CRLF to LF in 13 files (omemo2/*, AdminPage, TopBar, CHANGELOG)
- `.env.example` now documents VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, VAPID_EMAIL

### Added (Feature completion)
- Discovery page (`/discovery`) with public group directory + server health badge
- Discovery link in sidebar navigation
- Meta-contacts UI: "Merge contact" button in RightPanel contact details
- RAG "Ask AI" button in GlobalSearch footer
- GroupCallView fully wired into ChatPage with event-driven lifecycle
- GroupCallManager now emits `started`/`ended` events with `on`/`off` API
- New `/sso/oidc/exchange` endpoint for secure one-time code exchange
- Alembic migration `0005_sso_identities` + `SsoIdentity` model
- install.sh auto-installs `libldap2-dev` when `LDAP_ENABLED=true`
- i18n keys for discovery, meta-contacts, ask-ai (English + Chinese)
- `docs/PROJECT-STATUS.md` rewritten with accurate module status
- `MIGRATION_2.0_README.txt` updated to reflect `_experimental/` move

### Version
- Bumped to 1.5.1

## [1.5.0] - 2026-04-22 - Enterprise + advanced features (revised)

### Added (Enterprise integration)
- **SSO/OIDC** (`/sso/oidc/login`): Keycloak/Authentik/Auth0/Okta integration with optional auto-provisioning
- **LDAP** (`/sso/ldap/login`): direct LDAP bind for AD/OpenLDAP
- LoginPage discovers configured providers, renders SSO buttons + LDAP inline form
- `.env.example` documents OIDC/LDAP config

### Added (OMEMO trust UI)
- **BTBV trust panel** (`OmemoTrustView.tsx`): peer device fingerprints, Verify / Untrust buttons, QR-code share
- **New-device automatic warning**: when peer adds a new device, system message warns user to verify

### Added (Power features)
- **Screen sharing** (`session.startScreenShare()`)
- **Call recording** (`session.startRecording()`) - WebM VP9+Opus
- **Group calls** (mesh, `groupCall.ts`) + **GroupCallView** UI
- **Voice messages** (`VoiceRecorder.tsx`) - hold-to-record, Opus, waveform, 5min cap
- **Meta-contacts** (`metaContacts.ts`) merge multiple JIDs of one person; **synced via PEP**
- **Local full-text search** (`searchIndex.ts`) - MiniSearch + IndexedDB; GlobalSearch tries local first
- **Reaction quick-pick bar** (multiple quick reactions instead of single thumbs-up)
- **Long-press / right-click** message context menu
- **AI RAG** (`/ai/rag`) - retrieval-augmented Q&A over user's chat history with source citations

### Added (Discovery)
- **Public group directory** (`/discovery/groups`)
- **Server health badge** (`/discovery/health`)

### Added (Tests)
- test_sso.py, test_preview.py, test_discovery.py - 10 backend test files total

### Dependencies
- Backend: ldap3
- Frontend: minisearch, react-virtuoso

## [1.4.1] - 2026-04-22 - Polish + bonus features

### Added
- **Link previews**: messages with URLs now show Open Graph cards (title, description, image, site name).
  Backend `/preview` endpoint scrapes meta tags server-side (CORS-free), Redis-cached 1h, SSRF-protected
  (rejects internal/loopback URLs).
- **Contact notes & tags**: per-contact private notes ("met at conf 2024") + colored tags
  ("work" / "family"). Editable from chat info panel. Stored in rosterStore (cross-device sync via PEP planned).

### Polish from v1.4.0
- Reply UI verified complete (preview cards in bubbles + composer header)
- All i18n keys verified for both English and Chinese (call/notes/tags)

## [1.4.0] - 2026-04-22 - Major XEP & Killer Features Update

### Added (XMPP standard XEPs - parity with Conversations & Gajim)
- **XEP-0280** Message Carbons: messages now sync across all signed-in devices
- **XEP-0198** Stream Management: messages survive network drops, resume on reconnect
- **XEP-0352** Client State Indication: PWA tab in background tells server to throttle
- **XEP-0084** PEP User Avatar: avatars interop with Conversations/Gajim
- **XEP-0030 + XEP-0115** Service Discovery & Caps: peers know our capabilities
- **XEP-0392** Consistent Color Generation: same JID = same avatar color across XMPP clients
- **XEP-0357** Push Notifications: Web Push for PWA via VAPID + mod_cloud_notify
- **XEP-0384** OMEMO (real, libsignal-based): full Double Ratchet + X3DH
- **XEP-0166/0167/0176** Jingle audio/video calls via WebRTC + coturn

### Added (Conjiweb-exclusive killer features)
- **@ai mention** - AI assistant in any chat (`/ai <prompt>`)
- **Conversation insights** - sentiment + suggested action via AI
- **Slash commands** - /me /shrug /tableflip /translate /ai /summary /help, plugin-extensible
- **Inbound webhooks** - POST messages from Jenkins/GitLab/Sentry into conversations
- **Cross-device sync** - drafts, starred messages, read positions, pinned conversations
  sync via PEP private nodes (Conversations doesn't have this)
- **Admin dashboard** 鈥?daily activity, top conversations, storage usage, user stats

### Infrastructure
- coturn STUN/TURN auto-installed by install.sh, integrated with Prosody mod_external_services
- prosody-modules cloned for community modules (cloud_notify, turn_external)
- VAPID keypair auto-generated on install
- Database schema: push_subscriptions, webhooks tables (alembic 0002, 0003)

### Dependencies
- Added: @privacyresearch/libsignal-protocol-typescript (frontend)
- Added: pywebpush 2.0.0 (backend)

## [1.3.0] - 2026-04-22
### Fixed
- apiSocket.ts now passes JWT token via ?token= query param so WebSocket auth works
- apiSocket connected on login/add-account, disconnected on remove-account
- Message timestamps now show context-aware format: HH:mm / Yesterday / EEE HH:mm / MM/dd HH:mm
- "edited" label now shows full timestamp on hover
- e2ee peer public keys and OMEMO bundles migrated from localStorage to IndexedDB (no more 5MB risk)

### Added
- Message reactions (XEP-0444) now sync to XMPP peer in real time
- All avatar circles replaced with shared Avatar component (colored backgrounds, real photos, presence dots)
- Backend tests: attachment upload (auth, MIME, size), user-token (password, disabled, unknown), message search (account_id scope)

## [1.2.0] - 2026-04-22
### Fixed
- Refresh user JWT token after XMPP auto-reconnect so file uploads no longer return 401
- Restrict WebSocket endpoint `/ws/{account_id}` to authenticated users only (user token or admin token)
- Plugin toolbar actions no longer reload on every incoming message (removed `messages` from useEffect deps, use ref instead)
- Forward modal now has a search box; conversations with many chats are easy to find

### Added
- Starred Messages page (`/starred`): view all starred messages in one place, with jump-to-message links
- Star icon entry in Sidebar navigation
- Chinese and English i18n keys for starred messages

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

