"""Tests for call history endpoints."""
from datetime import UTC, datetime

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.database import get_db
from app.main import app
from app.models import CallLog
from app.utils.security import create_access_token


def _user_headers(account_id: str = "acc-1") -> dict[str, str]:
    token = create_access_token("alice@example.com", role="user", account_id=account_id)
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.anyio
async def test_log_call_requires_user_token():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/calls/log", json={})
    assert resp.status_code == 401


@pytest.mark.anyio
async def test_log_call_records_current_account():
    class _FakeDB:
        def __init__(self):
            self.added = None

        def add(self, obj):
            self.added = obj

        async def commit(self):
            return None

        async def refresh(self, obj):
            return None

    fake_db = _FakeDB()

    async def _fake_get_db():
        yield fake_db

    app.dependency_overrides[get_db] = _fake_get_db
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/calls/log",
                headers=_user_headers(),
                json={
                    "peer_jid": "bob@example.com",
                    "direction": "outgoing",
                    "media_types": "audio,video",
                    "status": "answered",
                    "duration_seconds": 42,
                    "started_at": "2026-04-29T10:00:00Z",
                    "ended_at": "2026-04-29T10:00:42Z",
                },
            )
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert resp.status_code == 200
    assert resp.json()["peer_jid"] == "bob@example.com"
    assert fake_db.added.account_id == "acc-1"


@pytest.mark.anyio
async def test_call_history_is_scoped_to_current_account():
    call = CallLog(
        id="call-1",
        account_id="acc-1",
        peer_jid="bob@example.com",
        direction="incoming",
        media_types="audio",
        status="missed",
        duration_seconds=0,
        started_at=datetime(2026, 4, 29, 10, 0, tzinfo=UTC),
        ended_at=None,
    )

    class _Scalars:
        def __iter__(self):
            return iter([call])

    class _Result:
        @staticmethod
        def scalars():
            return _Scalars()

    class _FakeDB:
        async def execute(self, *args, **kwargs):
            return _Result()

    async def _fake_get_db():
        yield _FakeDB()

    app.dependency_overrides[get_db] = _fake_get_db
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/calls/history", headers=_user_headers())
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert resp.status_code == 200
    assert resp.json()[0]["id"] == "call-1"
