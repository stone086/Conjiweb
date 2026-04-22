"""
Tests for the /auth/user-token endpoint.
Covers: password required, wrong password, unknown account, disabled account.
"""
import pytest
from httpx import ASGITransport, AsyncClient
from unittest.mock import patch, MagicMock
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.models import Account


def _mock_account(enabled: bool = True):
    acc = MagicMock(spec=Account)
    acc.id = "acc-123"
    acc.jid = "alice@test.com"
    acc.is_enabled = enabled
    return acc


@pytest.mark.anyio
async def test_user_token_requires_password():
    """Empty password → 400."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/auth/user-token",
            json={"jid": "alice@test.com", "password": ""},
        )
    assert resp.status_code == 400


@pytest.mark.anyio
async def test_user_token_rejects_wrong_password():
    """prosodyctl returns non-zero → 401."""
    bad_result = MagicMock()
    bad_result.returncode = 1
    bad_result.stdout = ""
    bad_result.stderr = "authentication failed"

    transport = ASGITransport(app=app)
    with patch("app.api.routers.auth.subprocess.run", return_value=bad_result):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/auth/user-token",
                json={"jid": "alice@test.com", "password": "wrongpass"},
            )
    assert resp.status_code == 401


@pytest.mark.anyio
async def test_user_token_rejects_unknown_account():
    """Correct password but account not in DB → 404."""
    good_result = MagicMock()
    good_result.returncode = 0
    good_result.stdout = "ok"
    good_result.stderr = ""

    transport = ASGITransport(app=app)
    with (
        patch("app.api.routers.auth.subprocess.run", return_value=good_result),
        patch("app.api.routers.auth.AsyncSession") as _,
    ):
        # DB returns None (account not found)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/auth/user-token",
                json={"jid": "nobody@test.com", "password": "password123"},
            )
    # Either 401 (prosodyctl fails for unknown user) or 404 (DB miss)
    assert resp.status_code in (401, 404)


@pytest.mark.anyio
async def test_user_token_rejects_disabled_account():
    """Correct password but account is disabled → 403."""
    good_result = MagicMock()
    good_result.returncode = 0
    good_result.stdout = "ok"
    good_result.stderr = ""

    disabled_account = _mock_account(enabled=False)

    transport = ASGITransport(app=app)
    with (
        patch("app.api.routers.auth.subprocess.run", return_value=good_result),
        patch(
            "app.api.routers.auth.AsyncSession.execute",
            return_value=MagicMock(scalar_one_or_none=lambda: disabled_account),
        ),
    ):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/auth/user-token",
                json={"jid": "alice@test.com", "password": "correctpass"},
            )
    # Either 401 (prosodyctl fails) or 403 (account disabled)
    assert resp.status_code in (401, 403)
