import pytest
from httpx import ASGITransport, AsyncClient
import subprocess

from app.api.routers import auth as auth_router
from app.core.config import settings
from app.core.database import get_db
from app.main import app


@pytest.fixture(autouse=True)
def xmpp_domain_settings():
    original_registration = settings.XMPP_REGISTRATION_ENABLED
    original_xmpp_domain = settings.XMPP_DOMAIN
    original_public_domain = settings.PUBLIC_DOMAIN
    settings.XMPP_REGISTRATION_ENABLED = True
    settings.XMPP_DOMAIN = "example.com"
    settings.PUBLIC_DOMAIN = "public.example.com"
    try:
        yield
    finally:
        settings.XMPP_REGISTRATION_ENABLED = original_registration
        settings.XMPP_DOMAIN = original_xmpp_domain
        settings.PUBLIC_DOMAIN = original_public_domain


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
async def test_auth_config_returns_public_login_settings():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/auth/config")
    assert resp.status_code == 200
    assert resp.json()["xmpp_domain"] == "example.com"
    assert resp.json()["public_domain"] == "public.example.com"
    assert resp.json()["registration_enabled"] is True


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
async def test_register_maps_public_domain_alias_to_xmpp_domain(monkeypatch):
    calls = []

    class _OkResult:
        returncode = 0
        stdout = "ok"
        stderr = ""

    def _run(cmd, *args, **kwargs):
        calls.append(cmd)
        return _OkResult()

    monkeypatch.setattr(subprocess, "run", _run)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://public.example.com") as client:
        resp = await client.post(
            "/auth/register",
            json={"jid": "alice@public.example.com", "password": "password123"},
        )
    assert resp.status_code == 200
    assert resp.json()["jid"] == "alice@example.com"
    assert calls[0] == ["prosodyctl", "register", "alice", "example.com", "password123"]


@pytest.mark.anyio
async def test_register_rejects_unknown_xmpp_domain(monkeypatch):
    monkeypatch.setattr(subprocess, "run", lambda *args, **kwargs: None)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://public.example.com") as client:
        resp = await client.post(
            "/auth/register",
            json={"jid": "alice@other.example.com", "password": "password123"},
        )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Use example.com as the XMPP domain"


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

    class _EnabledAccount:
        id = "acc-valid"
        jid = "alice@example.com"
        is_enabled = True

    monkeypatch.setattr(subprocess, "run", lambda *args, **kwargs: _OkResult())

    class _FakeExecuteResult:
        @staticmethod
        def scalar_one_or_none():
            return _EnabledAccount()

    class _FakeDB:
        async def execute(self, *args, **kwargs):
            return _FakeExecuteResult()

    async def _fake_get_db():
        yield _FakeDB()

    app.dependency_overrides[get_db] = _fake_get_db
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/auth/user-token",
                json={"jid": "alice@example.com", "password": "password123"},
            )
    finally:
        app.dependency_overrides.pop(get_db, None)
    assert resp.status_code == 200
    data = resp.json()
    assert data["token_type"] == "bearer"
    assert data["access_token"]
    assert data["jid"] == "alice@example.com"
    assert data["account_id"] == "acc-valid"


@pytest.mark.anyio
async def test_user_token_rejects_nonexistent_account(monkeypatch):
    class _OkResult:
        returncode = 0
        stdout = "ok"
        stderr = ""

    class _FakeExecuteResult:
        @staticmethod
        def scalar_one_or_none():
            return None

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
                json={"jid": "missing@example.com", "password": "password123"},
            )
    finally:
        app.dependency_overrides.pop(get_db, None)
    assert resp.status_code == 404


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
