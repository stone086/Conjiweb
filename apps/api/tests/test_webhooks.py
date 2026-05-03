"""Tests for webhook endpoints."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.anyio
async def test_trigger_webhook_401_invalid_token():
    """Webhook trigger rejects invalid webhook_id/token."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/webhooks/fake-id/fake-token",
            json={"message": "test"},
        )
    assert resp.status_code == 401


@pytest.mark.anyio
async def test_create_webhook_requires_admin():
    """Creating a webhook requires admin auth."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/webhooks",
            json={"name": "test", "conversation_id": "fake"},
        )
    assert resp.status_code in (401, 403)
