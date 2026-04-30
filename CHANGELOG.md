# Changelog

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

