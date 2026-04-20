import pytest
from httpx import AsyncClient

from app.main import app


@pytest.mark.anyio
async def test_protected_router_requires_auth():
    async with AsyncClient(app=app, base_url="http://test") as client:
        resp = await client.get("/accounts/")
    assert resp.status_code == 401


@pytest.mark.anyio
async def test_health_routes_are_public():
    async with AsyncClient(app=app, base_url="http://test") as client:
        r1 = await client.get("/health")
        r2 = await client.get("/api/health")
    assert r1.status_code == 200
    assert r2.status_code == 200
