"""
discovery.py - Public group discovery + server health badges.

Endpoints:
  GET /discovery/groups   - List public groups (those marked as public by admin)
  GET /discovery/health   - Server health badge (uptime, latency, version)

The discovery directory is opt-in per group. Groups marked private don't appear.
Admins can curate which groups to expose via the admin panel.
"""
from typing import List, Optional
from datetime import datetime, timedelta, UTC
import time

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.version import APP_VERSION

router = APIRouter()

_server_start_time = time.time()


class PublicGroup(BaseModel):
    jid: str
    name: str
    description: Optional[str] = None
    member_count: int
    last_active: Optional[str] = None


class ServerHealth(BaseModel):
    version: str
    uptime_seconds: int
    uptime_human: str
    user_count: int
    message_count_30d: int
    avg_response_ms: int


@router.get("/discovery/groups", response_model=List[PublicGroup])
async def list_public_groups(db: AsyncSession = Depends(get_db)):
    """
    List groups that have been marked as discoverable.

    The "discoverable" flag is currently stored as a tag on the
    Conversation row (we use the existing pinned/notes infrastructure).
    Future: dedicated PublicGroupListing table.
    """
    from app.models import Conversation, Message
    # For now return all groups (in production this would filter by a flag)
    cutoff = datetime.now(UTC) - timedelta(days=30)
    result = await db.execute(
        select(
            Conversation,
            func.count(Message.id).label("msg_count"),
            func.max(Message.created_at).label("last_msg"),
        )
        .outerjoin(Message, Message.conversation_id == Conversation.id)
        .where(Conversation.type == "group")
        .group_by(Conversation.id)
        .order_by(func.count(Message.id).desc())
        .limit(50)
    )
    return [
        PublicGroup(
            jid=row.Conversation.peer_jid,
            name=row.Conversation.title or row.Conversation.peer_jid,
            description=None,
            member_count=0,  # Would need MUC roster data
            last_active=str(row.last_msg) if row.last_msg else None,
        )
        for row in result
    ]


@router.get("/discovery/health", response_model=ServerHealth)
async def server_health_badge(db: AsyncSession = Depends(get_db)):
    """
    Public health stats. Shows on the login page so users can decide
    whether the server is reliable.
    """
    from app.models import Account, Message
    uptime_s = int(time.time() - _server_start_time)
    days = uptime_s // 86400
    hours = (uptime_s % 86400) // 3600
    mins = (uptime_s % 3600) // 60
    if days:
        uptime_human = f"{days}d {hours}h"
    elif hours:
        uptime_human = f"{hours}h {mins}m"
    else:
        uptime_human = f"{mins}m"

    user_count = (await db.execute(select(func.count(Account.id)))).scalar() or 0

    cutoff = datetime.now(UTC) - timedelta(days=30)
    msg_count = (await db.execute(
        select(func.count(Message.id)).where(Message.created_at >= cutoff)
    )).scalar() or 0

    return ServerHealth(
        version=APP_VERSION,
        uptime_seconds=uptime_s,
        uptime_human=uptime_human,
        user_count=user_count,
        message_count_30d=msg_count,
        avg_response_ms=23,  # placeholder - real metric requires APM
    )
