import pytest
from httpx import ASGITransport, AsyncClient
import subprocess

from app.api.routers import auth as auth_router
from app.core.config import settings
from app.main import app


@pytest.mark.anyio
async def test_admin_login_success_returns_token(monkeypatch):
    monkeypatch.setattr(auth_router, "ADMIN_USERNAME", "admin")
    monkeypatch.setattr(auth_router, "ADMIN_PASSWORD", "secret123")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/auth/admin/login",
            json={"username": "admin", "password": "secret123"},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["token_type"] == "bearer"
    assert data["access_token"]


@pytest.mark.anyio
async def test_admin_login_rejects_invalid_credentials(monkeypatch):
    monkeypatch.setattr(auth_router, "ADMIN_USERNAME", "admin")
    monkeypatch.setattr(auth_router, "ADMIN_PASSWORD", "secret123")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/auth/admin/login",
            json={"username": "admin", "password": "wrong"},
        )
    assert resp.status_code == 401


@pytest.mark.anyio
async def test_register_rejected_when_feature_disabled():
    original = settings.XMPP_REGISTRATION_ENABLED
    settings.XMPP_REGISTRATION_ENABLED = False
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/auth/register",
                json={"jid": "alice@example.com", "password": "password123"},
            )
        assert resp.status_code == 403
    finally:
        settings.XMPP_REGISTRATION_ENABLED = original


@pytest.mark.anyio
async def test_register_rejects_short_password():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/auth/register",
            json={"jid": "alice@example.com", "password": "123"},
        )
    assert resp.status_code == 400


@pytest.mark.anyio
async def test_register_uses_default_domain_when_missing(monkeypatch):
    class _OkResult:
        returncode = 0
        stdout = "ok"
        stderr = ""

    settings.XMPP_REGISTRATION_ENABLED = True
    original_domain = settings.XMPP_DOMAIN
    settings.XMPP_DOMAIN = "chat.example.com"
    monkeypatch.setattr(subprocess, "run", lambda *args, **kwargs: _OkResult())
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/auth/register",
                json={"jid": "alice", "password": "password123"},
            )
        assert resp.status_code == 200
        assert resp.json()["jid"] == "alice@chat.example.com"
    finally:
        settings.XMPP_DOMAIN = original_domain


@pytest.mark.anyio
async def test_register_returns_conflict_when_account_exists(monkeypatch):
    class _ConflictResult:
        returncode = 1
        stdout = ""
        stderr = "already exists"

    settings.XMPP_REGISTRATION_ENABLED = True
    monkeypatch.setattr(subprocess, "run", lambda *args, **kwargs: _ConflictResult())
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/auth/register",
            json={"jid": "alice@example.com", "password": "password123"},
        )
    assert resp.status_code == 409
