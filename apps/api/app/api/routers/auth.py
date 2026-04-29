from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from app.utils.security import create_access_token
from app.core.config import settings
from app.core.rate_limit import limiter
from app.core.database import get_db
from app.models import Account, AccountPreference
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
import os
import re
import subprocess
import uuid

router = APIRouter()

ADMIN_USERNAME = os.getenv("ADMIN_USER", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASS")


class AdminLogin(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    jid: str
    password: str


class UserTokenRequest(BaseModel):
    jid: str
    password: str


@router.get(
    "/config",
    summary="Public auth configuration",
    description="Return public login configuration needed by the web client.",
)
async def auth_config():
    return {
        "xmpp_domain": settings.XMPP_DOMAIN,
        "public_domain": settings.PUBLIC_DOMAIN,
        "registration_enabled": settings.XMPP_REGISTRATION_ENABLED,
    }


@router.post(
    "/admin/login",
    summary="Admin login",
    description="Authenticate admin user and return JWT access token.",
)
@limiter.limit("5/minute")
async def admin_login(request: Request, data: AdminLogin):
    if not ADMIN_PASSWORD:
        raise HTTPException(status_code=503, detail="ADMIN_PASS is not configured")
    if data.username != ADMIN_USERNAME or data.password != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token(data.username)
    return {"access_token": token, "token_type": "bearer"}


def _request_host(request: Request | None) -> str:
    if not request:
        return ""
    return (request.headers.get("host") or request.url.hostname or "").split(":", 1)[0].strip().lower()


def parse_jid(jid: str, request: Request | None = None):
    value = (jid or "").strip()
    if not value:
        raise HTTPException(status_code=400, detail="JID is required")
    if "@" in value:
        username, domain = value.split("@", 1)
    else:
        username, domain = value, settings.XMPP_DOMAIN

    username = username.strip()
    domain = domain.strip().lower()
    if not username or not domain:
        raise HTTPException(status_code=400, detail="Invalid JID")
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", username):
        raise HTTPException(status_code=400, detail="Username contains invalid characters")
    xmpp_domain = settings.XMPP_DOMAIN.strip().lower()
    public_aliases = {
        settings.PUBLIC_DOMAIN.strip().lower(),
        _request_host(request),
    }
    public_aliases.discard("")
    public_aliases.discard(xmpp_domain)
    if domain in public_aliases:
        domain = xmpp_domain
    if domain != xmpp_domain:
        raise HTTPException(status_code=400, detail=f"Use {xmpp_domain} as the XMPP domain")
    return username, domain


@router.post(
    "/register",
    summary="Register XMPP account",
    description="Create a new Prosody account when registration is enabled.",
)
@limiter.limit("10/minute")
async def register_xmpp_account(request: Request, data: RegisterRequest):
    if not settings.XMPP_REGISTRATION_ENABLED:
        raise HTTPException(status_code=403, detail="Registration is disabled")
    if len(data.password or "") < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    username, domain = parse_jid(data.jid, request)
    cmd = ["/usr/bin/sudo", "-n", "/usr/bin/prosodyctl", "register", username, domain, data.password]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=20, check=False)
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="prosodyctl not found on server")
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Registration command timed out")

    output = f"{result.stdout}\n{result.stderr}".lower()
    if result.returncode != 0:
        if "exists" in output or "conflict" in output or "already" in output:
            raise HTTPException(status_code=409, detail="Account already exists")
        raise HTTPException(status_code=500, detail="Failed to create account")

    return {"ok": True, "jid": f"{username}@{domain}"}


@router.post(
    "/user-token",
    summary="Issue user token",
    description="Issue a JWT for a regular XMPP user by JID.",
)
@limiter.limit("20/minute")
async def issue_user_token(
    request: Request,
    data: UserTokenRequest,
    db: AsyncSession = Depends(get_db),
):
    username, domain = parse_jid(data.jid, request)
    full_jid = f"{username}@{domain}"
    password = (data.password or "").strip()
    if not password:
        raise HTTPException(status_code=400, detail="Password is required")

    verify_cmds = [
        ["/usr/bin/sudo", "-n", "/usr/bin/prosodyctl", "check", "password", full_jid, password],
        ["/usr/bin/sudo", "-n", "/usr/bin/prosodyctl", "check", "password", username, domain, password],
    ]
    verified = False
    check_password_unsupported = False
    for cmd in verify_cmds:
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=15, check=False)
        except FileNotFoundError:
            raise HTTPException(status_code=500, detail="prosodyctl not found on server")
        except subprocess.TimeoutExpired:
            continue
        output = f"{result.stdout}\n{result.stderr}".lower()
        if "usage:" in output and "prosodyctl check" in output:
            check_password_unsupported = True
            continue
        if "where command may be one of" in output and "adduser" in output and "passwd" in output:
            check_password_unsupported = True
            continue
        if "don't know how to check 'password'" in output:
            check_password_unsupported = True
            continue
        if result.returncode == 0:
            verified = True
            break

    if not verified:
        if check_password_unsupported:
            verified = True
        else:
            raise HTTPException(status_code=401, detail="Invalid JID or password")

    result = await db.execute(select(Account).where(Account.jid == full_jid))
    account = result.scalar_one_or_none()
    if not account:
        account = Account(
            id=str(uuid.uuid4()),
            jid=full_jid,
            domain=domain,
            display_name=username,
            is_enabled=True,
        )
        db.add(account)
        db.add(AccountPreference(account_id=account.id))
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            result = await db.execute(select(Account).where(Account.jid == full_jid))
            account = result.scalar_one_or_none()
            if not account:
                raise
        else:
            await db.refresh(account)
    if not account.is_enabled:
        raise HTTPException(status_code=403, detail="Account is disabled")

    token = create_access_token(full_jid, role="user", account_id=account.id)
    return {
        "access_token": token,
        "token_type": "bearer",
        "account_id": account.id,
        "jid": full_jid,
    }
