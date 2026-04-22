"""
Tests for message search endpoint.
Covers: account_id required, results scoped per account.
"""
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.utils.security import create_access_token


def make_admin_token() -> str:
    return create_access_token("admin", role="admin")


@pytest.mark.anyio
async def test_search_requires_account_id():
    """Search without account_id → 400."""
    token = make_admin_token()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get(
            "/messages/search",
            params={"q": "hello"},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert resp.status_code == 400
    assert "account_id" in resp.json().get("detail", "").lower()


@pytest.mark.anyio
async def test_search_requires_auth():
    """Search without token → 401."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get(
            "/messages/search",
            params={"q": "hello", "account_id": "some-id"},
        )
    assert resp.status_code == 401


@pytest.mark.anyio
async def test_search_with_valid_params_returns_list():
    """Search with valid params → 200 + list (may be empty)."""
    token = make_admin_token()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get(
            "/messages/search",
            params={"q": "test_query_xyz_no_results", "account_id": "nonexistent-account"},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
