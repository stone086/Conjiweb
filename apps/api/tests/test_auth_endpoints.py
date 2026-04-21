import pytest
from httpx import ASGITransport, AsyncClient
import subprocess
import uuid

from app.api.routers import auth as auth_router
from app.core.config import settings
from app.core.database import get_db
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


@pytest.mark.anyio
async def test_user_token_requires_password():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/auth/user-token",
            json={"jid": "alice@example.com", "password": ""},
        )
    assert resp.status_code == 400


@pytest.mark.anyio
async def test_user_token_rejects_invalid_password(monkeypatch):
    class _FailResult:
        returncode = 1
        stdout = ""
        stderr = "authentication failed"

    monkeypatch.setattr(subprocess, "run", lambda *args, **kwargs: _FailResult())
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/auth/user-token",
            json={"jid": "alice@example.com", "password": "wrong"},
        )
    assert resp.status_code == 401


@pytest.mark.anyio
async def test_user_token_issues_token_when_credentials_valid(monkeypatch):
    class _OkResult:
        returncode = 0
        stdout = "ok"
        stderr = ""

    monkeypatch.setattr(subprocess, "run", lambda *args, **kwargs: _OkResult())

    class _FakeExecuteResult:
        @staticmethod
        def scalar_one_or_none():
            return None

    class _FakeDB:
        async def execute(self, *args, **kwargs):
            return _FakeExecuteResult()

        def add(self, _obj):
            return None

        async def commit(self):
            return None

        async def refresh(self, _obj):
            return None

    async def _fake_get_db():
        yield _FakeDB()

    app.dependency_overrides[get_db] = _fake_get_db
    unique_jid = f"u{uuid.uuid4().hex[:8]}@example.com"
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/auth/user-token",
                json={"jid": unique_jid, "password": "password123"},
            )
    finally:
        app.dependency_overrides.pop(get_db, None)
    assert resp.status_code == 200
    data = resp.json()
    assert data["token_type"] == "bearer"
    assert data["access_token"]
    assert data["jid"] == unique_jid
    assert data["account_id"]


@pytest.mark.anyio
async def test_user_token_rejects_disabled_account(monkeypatch):
    class _OkResult:
        returncode = 0
        stdout = "ok"
        stderr = ""

    class _DisabledAccount:
        id = "acc-disabled"
        jid = "disabled@example.com"
        is_enabled = False

    class _FakeExecuteResult:
        @staticmethod
        def scalar_one_or_none():
            return _DisabledAccount()

    class _FakeDB:
        async def execute(self, *args, **kwargs):
            return _FakeExecuteResult()

    async def _fake_get_db():
        yield _FakeDB()

    monkeypatch.setattr(subprocess, "run", lambda *args, **kwargs: _OkResult())
    app.dependency_overrides[get_db] = _fake_get_db
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/auth/user-token",
                json={"jid": "disabled@example.com", "password": "password123"},
            )
    finally:
        app.dependency_overrides.pop(get_db, None)
    assert resp.status_code == 403


@pytest.mark.anyio
async def test_user_token_existing_account_still_issues_token(monkeypatch):
    class _OkResult:
        returncode = 0
        stdout = "ok"
        stderr = ""

    class _EnabledAccount:
        id = "acc-existing"
        jid = "existing@example.com"
        is_enabled = True

    class _FakeExecuteResult:
        @staticmethod
        def scalar_one_or_none():
            return _EnabledAccount()

    class _FakeDB:
        async def execute(self, *args, **kwargs):
            return _FakeExecuteResult()

    async def _fake_get_db():
        yield _FakeDB()

    monkeypatch.setattr(subprocess, "run", lambda *args, **kwargs: _OkResult())
    app.dependency_overrides[get_db] = _fake_get_db
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/auth/user-token",
                json={"jid": "existing@example.com", "password": "password123"},
            )
    finally:
        app.dependency_overrides.pop(get_db, None)
    assert resp.status_code == 200
    assert resp.json()["account_id"] == "acc-existing"
