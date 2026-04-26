"""Tests for SSO endpoints."""
import os
import pytest
from httpx import ASGITransport, AsyncClient
from unittest.mock import patch

from app.main import app


@pytest.mark.anyio
async def test_sso_providers_returns_disabled_by_default():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/sso/providers")
    assert resp.status_code == 200
    data = resp.json()
    assert data["oidc"] is False
    assert data["ldap"] is False


@pytest.mark.anyio
async def test_oidc_login_404_when_disabled():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/sso/oidc/login")
    assert resp.status_code == 404


@pytest.mark.anyio
async def test_ldap_login_400_no_password():
    with patch.dict(os.environ, {"LDAP_ENABLED": "true", "LDAP_SERVER": "ldap://x"}):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/sso/ldap/login",
                json={"username": "alice", "password": ""},
            )
        assert resp.status_code == 400


@pytest.mark.anyio
async def test_ldap_login_404_when_disabled():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/sso/ldap/login",
            json={"username": "alice", "password": "x"},
        )
    assert resp.status_code == 404
