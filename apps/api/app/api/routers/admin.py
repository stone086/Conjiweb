from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.core.database import get_db
from app.models import AuditLog, Account, Message, Attachment
from app.services.audit import write_audit
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter()


@router.get("/status")
async def system_status(db: AsyncSession = Depends(get_db)):
    account_count = await db.scalar(select(func.count()).select_from(Account))
    message_count = await db.scalar(select(func.count()).select_from(Message))
    attachment_count = await db.scalar(select(func.count()).select_from(Attachment))
    return {
        "status": "healthy",
        "version": "3.0.0",
        "stats": {
            "accounts": account_count,
            "messages": message_count,
            "attachments": attachment_count,
        },
    }


@router.get("/audit-logs")
async def get_audit_logs(limit: int = 50, offset: int = 0, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit).offset(offset)
    )
    logs = result.scalars().all()
    return [
        {
            "id": l.id, "actor": l.actor, "action": l.action,
            "target_type": l.target_type, "target_id": l.target_id,
            "detail_json": l.detail_json,
            "created_at": str(l.created_at) if l.created_at else None,
        }
        for l in logs
    ]
