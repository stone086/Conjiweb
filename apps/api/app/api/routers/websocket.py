"""
websocket.py — Real-time push endpoint.
The frontend connects here to receive server-pushed events
(new message notifications, presence changes, etc.).
"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Dict, Set
import json
import asyncio

router = APIRouter()

# Connection manager
class ConnectionManager:
    def __init__(self):
        self.connections: Dict[str, Set[WebSocket]] = {}  # account_id -> set of ws

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
    await manager.connect(ws, account_id)
    try:
        # Send connected ack
        await ws.send_json({"type": "connected", "account_id": account_id})

        while True:
            # Keep alive — client sends pings
            try:
                data = await asyncio.wait_for(ws.receive_text(), timeout=30)
                msg = json.loads(data)
                if msg.get("type") == "ping":
                    await ws.send_json({"type": "pong"})
            except asyncio.TimeoutError:
                await ws.send_json({"type": "ping"})
            except Exception:
                break
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(ws, account_id)


# Helper to push events from other parts of the API
async def push_event(account_id: str, event_type: str, payload: dict):
    await manager.send_to_account(account_id, {"type": event_type, **payload})
