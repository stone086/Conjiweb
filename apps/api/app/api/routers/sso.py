"""
sso.py - Single Sign-On endpoints (OIDC + LDAP).

Two flows are supported:

1. OIDC (Keycloak / Authentik / Auth0 / Okta / etc.)
   - Frontend redirects user to /sso/oidc/login
   - We redirect to provider's authorize endpoint
   - Provider redirects back to /sso/oidc/callback with code
   - We exchange code for tokens, create one-time code, frontend exchanges for token

2. LDAP (Active Directory / OpenLDAP)
   - Frontend POSTs username + password to /sso/ldap/login
   - We bind to LDAP server with user credentials
   - On success, create / look up XMPP account, return user-token

All configuration is read from app.core.config.settings (pydantic-settings).
"""
import hashlib
import logging
import re
import secrets
import time
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Request, Depends
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import settings
from app.core.database import get_db
from app.core.rate_limit import limiter
from app.models import Account, AccountPreference, SsoIdentity, gen_uuid
from app.utils.security import create_access_token

try:
    import redis.asyncio as aioredis
except ImportError:
    aioredis = None  # type: ignore[assignment]

router = APIRouter()
logger = logging.getLogger("conjiweb.sso")

SSO_CODE_TTL = 30        # seconds for one-time exchange code
OIDC_STATE_TTL = 600     # seconds for OIDC CSRF state


# ---------------------------------------------------------------------------
# Redis helpers for OIDC state + one-time exchange codes
# ---------------------------------------------------------------------------
async def _get_redis():
    """Lazy Redis connection for SSO state storage."""
    if aioredis is None:
        return None
    try:
        r = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        await r.ping()
        return r
    except Exception:
        return None


# In-memory fallback (single-worker dev mode only)
_mem_store: dict[str, tuple[str, float]] = {}


async def _store_set(key: str, value: str, ttl: int) -> None:
    r = await _get_redis()
    if r:
        await r.setex(key, ttl, value)
        await r.aclose()
    else:
        _mem_store[key] = (value, time.time() + ttl)


async def _store_pop(key: str) -> Optional[str]:
    r = await _get_redis()
    if r:
        pipe = r.pipeline()
        pipe.get(key)
        pipe.delete(key)
        val, _ = await pipe.execute()
        await r.aclose()
        return val
    else:
        item = _mem_store.pop(key, None)
        if item and item[1] > time.time():
            return item[0]
        return None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _sanitize_username(raw: str) -> str:
    """Produce a safe XMPP localpart from a display name or username."""
    s = raw.lower().strip().replace(" ", "_")
    s = re.sub(r"[^a-z0-9._-]", "", s)
    return s[:64] or "user"


def _oidc_jid(sub: str, name: str) -> str:
    """
    Build a collision-resistant JID from OIDC claims.
    Uses the OIDC 'sub' claim hash to guarantee uniqueness even when
    two users share the same display name.
    """
    safe_name = _sanitize_username(name)
    sub_hash = hashlib.sha256(sub.encode()).hexdigest()[:8]
    return f"{safe_name}_{sub_hash}@{settings.XMPP_DOMAIN}"


async def _ensure_account(
    db: AsyncSession,
    jid: str,
    display_name: str,
    auto_provision: bool,
    provider: str = "",
    provider_sub: str = "",
    provider_email: str = "",
) -> Account:
    """Look up or auto-create an Account with its AccountPreference and SsoIdentity.

    Lookup precedence:
    1. By SsoIdentity (provider, provider_sub) — survives display-name changes
    2. By Account.jid — for backward compatibility / when no SSO identity yet
    3. Auto-provision if enabled
    """
    account = None

    # 1. Look up by SsoIdentity (most stable identifier)
    if provider and provider_sub:
        ident_result = await db.execute(
            select(SsoIdentity).where(
                SsoIdentity.provider == provider,
                SsoIdentity.provider_sub == provider_sub,
            )
        )
        identity = ident_result.scalar_one_or_none()
        if identity:
            acc_result = await db.execute(select(Account).where(Account.id == identity.account_id))
            account = acc_result.scalar_one_or_none()

    # 2. Fall back to JID lookup (for accounts created before SSO migration)
    if not account:
        result = await db.execute(select(Account).where(Account.jid == jid))
        account = result.scalar_one_or_none()
        # If found by JID but no SsoIdentity yet, link them
        if account and provider and provider_sub:
            db.add(SsoIdentity(
                id=gen_uuid(),
                account_id=account.id,
                provider=provider,
                provider_sub=provider_sub,
                provider_email=provider_email or None,
            ))
            await db.commit()

    # 3. Auto-provision
    if not account:
        if not auto_provision:
            raise HTTPException(403, f"Account {jid} not provisioned. Ask admin to create it.")
        domain = jid.split("@", 1)[1] if "@" in jid else settings.XMPP_DOMAIN
        account = Account(
            id=gen_uuid(),
            jid=jid,
            domain=domain,
            display_name=display_name,
            is_enabled=True,
        )
        db.add(account)
        db.add(AccountPreference(account_id=account.id))
        if provider and provider_sub:
            db.add(SsoIdentity(
                id=gen_uuid(),
                account_id=account.id,
                provider=provider,
                provider_sub=provider_sub,
                provider_email=provider_email or None,
            ))
        await db.commit()

    if not account.is_enabled:
        raise HTTPException(403, "Account is disabled")
    return account


# ---------------------------------------------------------------------------
# Provider discovery
# ---------------------------------------------------------------------------
@router.get("/sso/providers")
async def list_providers():
    """Tell the frontend which SSO methods are configured."""
    return {
        "oidc": settings.OIDC_ENABLED,
        "ldap": settings.LDAP_ENABLED,
        "oidc_label": settings.OIDC_LABEL,
        "ldap_label": settings.LDAP_LABEL,
    }


# =====================================================
# OIDC flow (with secure one-time code exchange)
# =====================================================
@router.get("/sso/oidc/login")
async def oidc_login():
    """Start OIDC authorization code flow."""
    if not settings.OIDC_ENABLED:
        raise HTTPException(404, "OIDC not configured")

    issuer = settings.OIDC_ISSUER.rstrip("/")
    client_id = settings.OIDC_CLIENT_ID
    redirect_uri = settings.OIDC_REDIRECT_URI
    if not (issuer and client_id and redirect_uri):
        raise HTTPException(503, "OIDC misconfigured")

    state = secrets.token_urlsafe(32)
    await _store_set(f"oidc:state:{state}", "1", OIDC_STATE_TTL)

    # Discover authorization endpoint
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            disc = await client.get(f"{issuer}/.well-known/openid-configuration")
            disc.raise_for_status()
            auth_endpoint = disc.json()["authorization_endpoint"]
        except Exception as e:
            raise HTTPException(502, f"OIDC discovery failed: {e}")

    params = httpx.QueryParams({
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
    })
    return RedirectResponse(f"{auth_endpoint}?{params}")


@router.get("/sso/oidc/callback")
async def oidc_callback(
    code: str,
    state: str,
    db: AsyncSession = Depends(get_db),
):
    """Handle OIDC redirect back from provider."""
    # Validate CSRF state (stored in Redis)
    stored = await _store_pop(f"oidc:state:{state}")
    if not stored:
        raise HTTPException(400, "Invalid or expired state")

    issuer = settings.OIDC_ISSUER.rstrip("/")
    client_id = settings.OIDC_CLIENT_ID
    client_secret = settings.OIDC_CLIENT_SECRET
    redirect_uri = settings.OIDC_REDIRECT_URI

    async with httpx.AsyncClient(timeout=10.0) as client:
        # Discover endpoints
        disc = await client.get(f"{issuer}/.well-known/openid-configuration")
        disc.raise_for_status()
        meta = disc.json()
        token_endpoint = meta["token_endpoint"]
        userinfo_endpoint = meta["userinfo_endpoint"]

        # Exchange code for token
        token_resp = await client.post(
            token_endpoint,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
                "client_id": client_id,
                "client_secret": client_secret,
            },
        )
        if token_resp.status_code >= 400:
            raise HTTPException(401, "OIDC token exchange failed")
        token_data = token_resp.json()
        access_token = token_data.get("access_token")
        id_token_raw = token_data.get("id_token")
        if not access_token:
            raise HTTPException(401, "No access_token from OIDC provider")

        # Verify id_token signature if present (best practice per OIDC spec)
        id_token_claims: dict = {}
        if id_token_raw and meta.get("jwks_uri"):
            try:
                from jose import jwt as jose_jwt, JWTError
                jwks_resp = await client.get(meta["jwks_uri"])
                jwks_resp.raise_for_status()
                jwks = jwks_resp.json()
                id_token_claims = jose_jwt.decode(
                    id_token_raw,
                    jwks,
                    algorithms=meta.get("id_token_signing_alg_values_supported", ["RS256"]),
                    audience=client_id,
                    issuer=issuer,
                    options={"verify_at_hash": False},
                )
            except (JWTError, ImportError, Exception):
                # Fall through to userinfo endpoint as fallback
                id_token_claims = {}

        # Get user info (authoritative fallback, always called)
        ui = await client.get(
            userinfo_endpoint,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if ui.status_code >= 400:
            raise HTTPException(401, "OIDC userinfo failed")
        userinfo = ui.json()

    # Prefer verified id_token claims, fall back to userinfo
    merged = {**userinfo, **{k: v for k, v in id_token_claims.items() if v}}

    email = merged.get("email")
    if not email:
        raise HTTPException(401, "OIDC user has no email claim")
    sub = merged.get("sub", email)
    name = merged.get("name") or merged.get("preferred_username") or email.split("@")[0]

    # Build collision-resistant JID using sub claim hash
    jid = _oidc_jid(sub, name)
    account = await _ensure_account(
        db, jid, name, settings.AUTO_PROVISION_OIDC,
        provider="oidc", provider_sub=sub, provider_email=email,
    )

    # Issue internal user token
    user_token = create_access_token(jid, role="user", account_id=account.id)

    # Store a one-time code in Redis; frontend exchanges code for token
    exchange_code = secrets.token_urlsafe(48)
    await _store_set(
        f"oidc:code:{exchange_code}",
        f"{user_token}||{jid}",
        SSO_CODE_TTL,
    )

    frontend_url = settings.FRONTEND_URL or "/"
    return RedirectResponse(f"{frontend_url}#sso-code={exchange_code}")


@router.post("/sso/oidc/exchange")
@limiter.limit("20/minute")
async def oidc_exchange_code(request: Request, code: str):
    """
    Exchange a one-time SSO code for an access token.
    The code lives for 30 seconds and can only be used once.
    """
    stored = await _store_pop(f"oidc:code:{code}")
    if not stored:
        raise HTTPException(401, "Invalid or expired SSO code")
    token, jid = stored.split("||", 1)
    return {"access_token": token, "jid": jid}


# =====================================================
# LDAP flow (with rate limiting)
# =====================================================
class LdapLoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=128)
    password: str = Field(..., min_length=1, max_length=256)


@router.post("/sso/ldap/login")
@limiter.limit("10/minute")
async def ldap_login(
    request: Request,
    payload: LdapLoginRequest,
    db: AsyncSession = Depends(get_db),
):
    """Authenticate via LDAP bind, then issue user-token."""
    if not settings.LDAP_ENABLED:
        raise HTTPException(404, "LDAP not configured")
    if not payload.username or not payload.password:
        raise HTTPException(400, "username and password required")

    server_url = settings.LDAP_SERVER
    bind_template = settings.LDAP_BIND_DN_TEMPLATE
    if not server_url:
        raise HTTPException(503, "LDAP misconfigured")

    bind_dn = bind_template.replace("{username}", payload.username)

    def _ldap_bind() -> None:
        """Synchronous LDAP bind, run in worker thread to avoid blocking event loop."""
        from ldap3 import Server, Connection, ALL, SIMPLE
        srv = Server(server_url, get_info=ALL)
        conn = Connection(
            srv,
            user=bind_dn,
            password=payload.password,
            authentication=SIMPLE,
            auto_bind=True,
            raise_exceptions=True,
        )
        conn.unbind()

    try:
        import asyncio
        await asyncio.to_thread(_ldap_bind)
    except ImportError:
        raise HTTPException(503, "ldap3 library not installed on server")
    except Exception as exc:
        logger.warning(
            f"ldap_auth_failed username={payload.username} "
            f"client={request.client.host if request.client else '?'} "
            f"error={type(exc).__name__}"
        )
        raise HTTPException(401, "LDAP authentication failed")

    # Build JID from LDAP username
    safe_name = _sanitize_username(payload.username)
    jid = f"{safe_name}@{settings.XMPP_DOMAIN}"
    account = await _ensure_account(
        db, jid, payload.username, settings.AUTO_PROVISION_LDAP,
        provider="ldap", provider_sub=bind_dn,
    )

    token = create_access_token(jid, role="user", account_id=account.id)
    return {"access_token": token, "jid": jid}
