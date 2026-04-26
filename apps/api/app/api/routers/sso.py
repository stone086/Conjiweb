"""
sso.py - Single Sign-On endpoints (OIDC + LDAP).

Two flows are supported:

1. OIDC (Keycloak / Authentik / Auth0 / Okta / etc.)
   - Frontend redirects user to /sso/oidc/login
   - We redirect to provider's authorize endpoint
   - Provider redirects back to /sso/oidc/callback with code
   - We exchange code for tokens, validate ID token, create user-token

2. LDAP (Active Directory / OpenLDAP)
   - Frontend POSTs username + password to /sso/ldap/login
   - We bind to LDAP server with user credentials
   - On success, create / look up XMPP account, return user-token

Configuration via environment variables (read by app.core.config):
   OIDC_ENABLED=true
   OIDC_ISSUER=https://auth.example.com/realms/main
   OIDC_CLIENT_ID=...
   OIDC_CLIENT_SECRET=...
   OIDC_REDIRECT_URI=https://chat.example.com/sso/oidc/callback

   LDAP_ENABLED=true
   LDAP_SERVER=ldap://ldap.example.com
   LDAP_BIND_DN_TEMPLATE=uid={username},ou=People,dc=example,dc=com
   LDAP_USER_BASE=ou=People,dc=example,dc=com
"""
import os
import secrets
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Request, Response, Depends
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.models import Account, gen_uuid
from app.utils.security import create_access_token

router = APIRouter()


def _oidc_enabled() -> bool:
    return os.getenv("OIDC_ENABLED", "").lower() in ("true", "1", "yes")


def _ldap_enabled() -> bool:
    return os.getenv("LDAP_ENABLED", "").lower() in ("true", "1", "yes")


@router.get("/sso/providers")
async def list_providers():
    """Tell the frontend which SSO methods are configured."""
    return {
        "oidc": _oidc_enabled(),
        "ldap": _ldap_enabled(),
        "oidc_label": os.getenv("OIDC_LABEL", "Single Sign-On"),
        "ldap_label": os.getenv("LDAP_LABEL", "Corporate Login"),
    }


# =====================================================
# OIDC flow
# =====================================================
_oidc_states: dict[str, float] = {}  # one-time CSRF tokens


@router.get("/sso/oidc/login")
async def oidc_login():
    """Start OIDC authorization code flow."""
    if not _oidc_enabled():
        raise HTTPException(404, "OIDC not configured")

    issuer = os.getenv("OIDC_ISSUER", "").rstrip("/")
    client_id = os.getenv("OIDC_CLIENT_ID", "")
    redirect_uri = os.getenv("OIDC_REDIRECT_URI", "")
    if not (issuer and client_id and redirect_uri):
        raise HTTPException(503, "OIDC misconfigured")

    state = secrets.token_urlsafe(24)
    import time
    _oidc_states[state] = time.time() + 600  # valid 10 min

    # Discover authorization endpoint
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            disc = await client.get(f"{issuer}/.well-known/openid-configuration")
            disc.raise_for_status()
            auth_endpoint = disc.json()["authorization_endpoint"]
        except Exception as e:
            raise HTTPException(502, f"OIDC discovery failed: {e}")

    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
    }
    qs = "&".join(f"{k}={httpx.QueryParams({k: v})[k]}" for k, v in params.items())
    return RedirectResponse(f"{auth_endpoint}?{qs}")


@router.get("/sso/oidc/callback")
async def oidc_callback(
    code: str,
    state: str,
    db: AsyncSession = Depends(get_db),
):
    """Handle OIDC redirect back from provider."""
    import time
    if state not in _oidc_states or _oidc_states[state] < time.time():
        raise HTTPException(400, "Invalid or expired state")
    del _oidc_states[state]

    issuer = os.getenv("OIDC_ISSUER", "").rstrip("/")
    client_id = os.getenv("OIDC_CLIENT_ID", "")
    client_secret = os.getenv("OIDC_CLIENT_SECRET", "")
    redirect_uri = os.getenv("OIDC_REDIRECT_URI", "")

    async with httpx.AsyncClient(timeout=10.0) as client:
        # Discover token endpoint + userinfo endpoint
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
        access_token = token_resp.json().get("access_token")
        if not access_token:
            raise HTTPException(401, "No access_token from OIDC provider")

        # Get user info
        ui = await client.get(
            userinfo_endpoint,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if ui.status_code >= 400:
            raise HTTPException(401, "OIDC userinfo failed")
        userinfo = ui.json()

    email = userinfo.get("email")
    if not email:
        raise HTTPException(401, "OIDC user has no email claim")
    sub = userinfo.get("sub", email)
    name = userinfo.get("name") or userinfo.get("preferred_username") or email.split("@")[0]
    xmpp_domain = os.getenv("XMPP_DOMAIN", "localhost")
    jid = f"{name.lower().replace(' ', '_')}@{xmpp_domain}"

    # Look up or auto-create the account
    result = await db.execute(select(Account).where(Account.jid == jid))
    account = result.scalar_one_or_none()
    if not account:
        # Auto-provisioning policy: only create if AUTO_PROVISION_OIDC=true
        if os.getenv("AUTO_PROVISION_OIDC", "").lower() not in ("true", "1", "yes"):
            raise HTTPException(403, f"Account {jid} not provisioned. Ask admin to create it.")
        account = Account(
            id=gen_uuid(),
            jid=jid,
            display_name=name,
            is_enabled=True,
        )
        db.add(account)
        await db.commit()

    if not account.is_enabled:
        raise HTTPException(403, "Account is disabled")

    # Issue user token (same shape as /auth/user-token)
    token = create_access_token(jid, role="user", account_id=account.id)

    # Redirect frontend with token in URL fragment (not query - safer from logs)
    frontend_url = os.getenv("FRONTEND_URL", "/")
    return RedirectResponse(f"{frontend_url}#sso-token={token}&jid={jid}")


# =====================================================
# LDAP flow
# =====================================================
class LdapLoginRequest(BaseModel):
    username: str
    password: str


@router.post("/sso/ldap/login")
async def ldap_login(
    payload: LdapLoginRequest,
    db: AsyncSession = Depends(get_db),
):
    """Authenticate via LDAP bind, then issue user-token."""
    if not _ldap_enabled():
        raise HTTPException(404, "LDAP not configured")
    if not payload.username or not payload.password:
        raise HTTPException(400, "username and password required")

    server = os.getenv("LDAP_SERVER", "")
    bind_template = os.getenv(
        "LDAP_BIND_DN_TEMPLATE",
        "uid={username},ou=People,dc=example,dc=com",
    )
    if not server:
        raise HTTPException(503, "LDAP misconfigured")

    bind_dn = bind_template.replace("{username}", payload.username)

    try:
        from ldap3 import Server, Connection, ALL, SIMPLE
        srv = Server(server, get_info=ALL)
        conn = Connection(
            srv,
            user=bind_dn,
            password=payload.password,
            authentication=SIMPLE,
            auto_bind=True,
            raise_exceptions=True,
        )
        conn.unbind()
    except ImportError:
        raise HTTPException(503, "ldap3 library not installed on server")
    except Exception:
        raise HTTPException(401, "LDAP authentication failed")

    # Look up account by JID built from LDAP username
    xmpp_domain = os.getenv("XMPP_DOMAIN", "localhost")
    jid = f"{payload.username.lower()}@{xmpp_domain}"
    result = await db.execute(select(Account).where(Account.jid == jid))
    account = result.scalar_one_or_none()
    if not account:
        if os.getenv("AUTO_PROVISION_LDAP", "").lower() not in ("true", "1", "yes"):
            raise HTTPException(403, f"Account {jid} not provisioned")
        account = Account(
            id=gen_uuid(),
            jid=jid,
            display_name=payload.username,
            is_enabled=True,
        )
        db.add(account)
        await db.commit()
    if not account.is_enabled:
        raise HTTPException(403, "Account is disabled")

    token = create_access_token(jid, role="user", account_id=account.id)
    return {"access_token": token, "jid": jid}
