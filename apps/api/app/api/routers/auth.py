from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from app.utils.security import create_access_token
from app.core.config import settings
from app.core.rate_limit import limiter
import os
import re
import subprocess

router = APIRouter()

ADMIN_USERNAME = os.getenv("ADMIN_USER", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASS")


class AdminLogin(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    jid: str
    password: str


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


def parse_jid(jid: str):
    value = (jid or "").strip()
    if not value:
        raise HTTPException(status_code=400, detail="JID is required")
    if "@" in value:
        username, domain = value.split("@", 1)
    else:
        username, domain = value, settings.XMPP_DOMAIN

    username = username.strip()
    domain = domain.strip()
    if not username or not domain:
        raise HTTPException(status_code=400, detail="Invalid JID")
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", username):
        raise HTTPException(status_code=400, detail="Username contains invalid characters")
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

    username, domain = parse_jid(data.jid)
    cmd = ["prosodyctl", "register", username, domain, data.password]

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
