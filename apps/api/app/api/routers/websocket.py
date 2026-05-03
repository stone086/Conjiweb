"""
websocket.py - Real-time push endpoint.
The frontend connects here to receive server-pushed events
(new message notifications, presence changes, etc.).
"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Dict, Set
from app.utils.security import decode_token
import json
import asyncio

router = APIRouter()


class ConnectionManager:
    def __init__(self):
        self.connections: Dict[str, Set[WebSocket]] = {}

    async def connect(self, ws: WebSocket, account_id: str):
        await ws.accept()
        if account_id not in self.connections:
            self.connections[account_id] = set()
        self.connections[account_id].add(ws)

    def disconnect(self, ws: WebSocket, account_id: str):
        if account_id in self.connections:
            self.connections[account_id].discard(ws)
            if not self.connections[account_id]:
                del self.connections[account_id]

    async def send_to_account(self, account_id: str, data: dict):
        if account_id not in self.connections:
            return
        dead = set()
        for ws in self.connections[account_id]:
            try:
                await ws.send_json(data)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self.connections[account_id].discard(ws)

    async def broadcast(self, data: dict):
        for account_id in list(self.connections.keys()):
            await self.send_to_account(account_id, data)


manager = ConnectionManager()


@router.websocket("/ws/{account_id}")
async def websocket_endpoint(ws: WebSocket, account_id: str):
    # Authenticate via token query param (WebSocket cannot use Authorization header)
    token = ws.query_params.get("token")
    if not token:
        await ws.close(code=4001, reason="Missing token")
        return
    try:
        payload = decode_token(token)
        role = payload.get("role")
        token_account_id = payload.get("account_id")
        # Accept user token only for the matching account; admin token for any account
        if role == "user" and token_account_id != account_id:
            await ws.close(code=4003, reason="Token account mismatch")
            return
        if role not in ("user", "admin"):
            await ws.close(code=4003, reason="Invalid token role")
            return
    except Exception:
        await ws.close(code=4001, reason="Invalid or expired token")
        return

    # Limit concurrent connections per account (prevent resource exhaustion)
    MAX_CONNECTIONS_PER_ACCOUNT = 10
    existing = manager.connections.get(account_id, set())
    if len(existing) >= MAX_CONNECTIONS_PER_ACCOUNT:
        await ws.close(code=4008, reason="Too many connections")
        return

    await manager.connect(ws, account_id)
    consecutive_timeouts = 0
    MAX_IDLE_TIMEOUTS = 6  # 6 * 30s = 3 minutes idle → disconnect
    try:
        await ws.send_json({"type": "connected", "account_id": account_id})
        while True:
            try:
                data = await asyncio.wait_for(ws.receive_text(), timeout=30)
                consecutive_timeouts = 0
                msg = json.loads(data)
                if msg.get("type") == "ping":
                    await ws.send_json({"type": "pong"})
            except asyncio.TimeoutError:
                consecutive_timeouts += 1
                if consecutive_timeouts >= MAX_IDLE_TIMEOUTS:
                    await ws.close(code=4009, reason="Idle timeout")
                    break
                await ws.send_json({"type": "ping"})
            except Exception:
                break
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(ws, account_id)


async def push_event(account_id: str, event_type: str, payload: dict):
    await manager.send_to_account(account_id, {"type": event_type, **payload})
