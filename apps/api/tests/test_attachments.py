"""
Tests for the attachment upload endpoint.
Covers: auth requirement, MIME validation, size limit.
"""
import io
import pytest
from starlette.requests import Request
from httpx import ASGITransport, AsyncClient
from unittest.mock import patch, MagicMock

from app.main import app
from app.api.routers import auth as auth_router
from app.api.routers import attachments as attachments_router
from app.utils.security import create_access_token


def make_user_token(account_id: str = "test-account-id") -> str:
    return create_access_token("user@test.com", role="user", account_id=account_id)


def make_admin_token() -> str:
    return create_access_token("admin", role="admin")


def make_request(path: str) -> Request:
    return Request({
        "type": "http",
        "method": "GET",
        "path": path,
        "query_string": path.split("?", 1)[1].encode() if "?" in path else b"",
        "headers": [],
    })


@pytest.mark.anyio
async def test_upload_requires_auth():
    """Upload without token → 401."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/attachments/upload",
            files={"file": ("test.txt", b"hello", "text/plain")},
        )
    assert resp.status_code == 401


@pytest.mark.anyio
async def test_upload_rejects_admin_token():
    """Attachment upload requires user token, not admin token."""
    token = make_admin_token()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/attachments/upload",
            headers={"Authorization": f"Bearer {token}"},
            files={"file": ("test.txt", b"hello", "text/plain")},
        )
    # 403: token valid but wrong role
    assert resp.status_code == 403


@pytest.mark.anyio
async def test_upload_empty_file():
    """Empty file → 400."""
    token = make_user_token()
    transport = ASGITransport(app=app)
    with (
        patch("app.api.routers.attachments.magic") as mock_magic,
        patch("app.api.routers.attachments.minio_client") as mock_minio,
        patch("app.api.routers.attachments.ensure_bucket"),
    ):
        mock_magic.from_buffer.return_value = "text/plain"
        mock_minio.put_object = MagicMock()
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/attachments/upload",
                headers={"Authorization": f"Bearer {token}"},
                files={"file": ("empty.txt", b"", "text/plain")},
            )
    assert resp.status_code == 400


@pytest.mark.anyio
async def test_upload_rejects_disallowed_mime():
    """Executable file disguised as text → 415."""
    token = make_user_token()
    transport = ASGITransport(app=app)
    with (
        patch("app.api.routers.attachments.magic") as mock_magic,
        patch("app.api.routers.attachments.ensure_bucket"),
    ):
        mock_magic.from_buffer.return_value = "application/x-executable"
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/attachments/upload",
                headers={"Authorization": f"Bearer {token}"},
                files={"file": ("virus.txt", b"\x7fELF", "text/plain")},
            )
    assert resp.status_code == 415


@pytest.mark.anyio
async def test_upload_size_limit():
    """File over 100 MB → 413."""
    token = make_user_token()
    big_file = b"x" * (101 * 1024 * 1024)
    transport = ASGITransport(app=app)
    with patch("app.api.routers.attachments.ensure_bucket"):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/attachments/upload",
                headers={"Authorization": f"Bearer {token}"},
                files={"file": ("big.txt", big_file, "text/plain")},
            )
    assert resp.status_code == 413


@pytest.mark.anyio
async def test_download_streams_private_minio_object_with_query_token(monkeypatch):
    token = make_user_token()

    class _Result:
        def scalar_one_or_none(self):
            return None

    class _Db:
        async def execute(self, _stmt):
            return _Result()

    class _Object:
        def stream(self, _size):
            yield b"hello"

        def close(self):
            pass

        def release_conn(self):
            pass

    async def _allowed(_db, object_key, actor):
        return object_key == "uploads/a.txt" and actor["account_id"] == "test-account-id"

    monkeypatch.setattr(attachments_router, "_user_can_access_object", _allowed)
    monkeypatch.setattr(attachments_router.minio_client, "get_object", lambda *_args: _Object())

    response = await attachments_router.download_file(
        "uploads/a.txt",
        make_request(f"/attachments/download/uploads/a.txt?t={token}"),
        _Db(),
    )

    assert response.status_code == 200
    assert response.headers["x-content-type-options"] == "nosniff"
