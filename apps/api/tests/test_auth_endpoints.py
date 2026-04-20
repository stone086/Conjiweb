import pytest
from httpx import ASGITransport, AsyncClient

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
