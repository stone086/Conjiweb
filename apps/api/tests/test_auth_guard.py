import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.utils.security import create_access_token
from app.api.routers import attachments as attachments_router


@pytest.mark.anyio
async def test_protected_router_requires_auth():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/accounts/")
    assert resp.status_code == 401


@pytest.mark.anyio
async def test_health_routes_are_public():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r1 = await client.get("/health")
        r2 = await client.get("/api/health")
    assert r1.status_code == 200
    assert r2.status_code == 200


@pytest.mark.anyio
async def test_attachment_upload_requires_user_token():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/attachments/upload",
            files={"file": ("a.txt", b"hello", "text/plain")},
        )
    assert resp.status_code == 401


@pytest.mark.anyio
async def test_attachment_upload_rejects_unsupported_mime(monkeypatch):
    class _Magic:
        @staticmethod
        def from_buffer(_content: bytes, mime: bool = True):
            return "application/x-msdownload" if mime else "application/x-msdownload"

    monkeypatch.setattr(attachments_router, "magic", _Magic())
    token = create_access_token("user@example.com", role="user", account_id="acc-1")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/attachments/upload",
            files={"file": ("bad.exe", b"MZ", "application/octet-stream")},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert resp.status_code == 415


@pytest.mark.anyio
async def test_message_search_requires_account_id_with_admin_token():
    token = create_access_token("admin")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get(
            "/messages/search",
            params={"q": "hello"},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert resp.status_code == 400
