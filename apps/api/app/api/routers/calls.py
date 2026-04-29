"""Call history endpoints."""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models import CallLog, gen_uuid
from app.utils.security import get_current_user

router = APIRouter()


class CallLogRecord(BaseModel):
    peer_jid: str
    direction: str
    media_types: str
    status: str
    duration_seconds: Optional[int] = None
    started_at: datetime
    ended_at: Optional[datetime] = None


class CallLogOut(CallLogRecord):
    id: str


@router.post("/calls/log", response_model=CallLogOut)
async def log_call(
    record: CallLogRecord,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    log = CallLog(
        id=gen_uuid(),
        account_id=user["account_id"],
        peer_jid=record.peer_jid,
        direction=record.direction,
        media_types=record.media_types,
        status=record.status,
        duration_seconds=record.duration_seconds,
        started_at=record.started_at,
        ended_at=record.ended_at,
    )
    db.add(log)
    await db.commit()
    await db.refresh(log)
    return CallLogOut(
        id=log.id,
        peer_jid=log.peer_jid,
        direction=log.direction,
        media_types=log.media_types,
        status=log.status,
        duration_seconds=log.duration_seconds,
        started_at=log.started_at,
        ended_at=log.ended_at,
    )


@router.get("/calls/history", response_model=List[CallLogOut])
async def call_history(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    result = await db.execute(
        select(CallLog)
        .where(CallLog.account_id == user["account_id"])
        .order_by(desc(CallLog.started_at))
        .offset(offset)
        .limit(limit)
    )
    return [
        CallLogOut(
            id=call.id,
            peer_jid=call.peer_jid,
            direction=call.direction,
            media_types=call.media_types,
            status=call.status,
            duration_seconds=call.duration_seconds,
            started_at=call.started_at,
            ended_at=call.ended_at,
        )
        for call in result.scalars()
    ]


@router.delete("/calls/log/{log_id}")
async def delete_call_log(
    log_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    log = (
        await db.execute(
            select(CallLog).where(
                CallLog.id == log_id,
                CallLog.account_id == user["account_id"],
            )
        )
    ).scalar_one_or_none()
    if not log:
        raise HTTPException(status_code=404, detail="Call log not found")
    await db.delete(log)
    await db.commit()
    return {"status": "deleted"}
