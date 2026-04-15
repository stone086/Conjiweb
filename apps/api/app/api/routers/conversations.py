from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from pydantic import BaseModel
from typing import Optional, List
from app.core.database import get_db
from app.models import Conversation, Message
import uuid

router = APIRouter()


class ConversationCreate(BaseModel):
    account_id: str
    type: str  # private/group/system
    peer_jid: str
    title: Optional[str] = None
    avatar_url: Optional[str] = None


class ConversationResponse(BaseModel):
    id: str
    account_id: str
    type: str
    peer_jid: str
    title: Optional[str]
    unread_count: int
    pinned: bool
    archived: bool

    class Config:
        from_attributes = True


@router.get("/", response_model=List[ConversationResponse])
async def list_conversations(account_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Conversation)
        .where(Conversation.account_id == account_id, Conversation.archived == False)
        .order_by(Conversation.last_message_at.desc())
    )
    return result.scalars().all()


@router.post("/", response_model=ConversationResponse)
async def create_or_get_conversation(data: ConversationCreate, db: AsyncSession = Depends(get_db)):
    # Check if exists
    result = await db.execute(
        select(Conversation).where(
            Conversation.account_id == data.account_id,
            Conversation.peer_jid == data.peer_jid,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        return existing

    conv = Conversation(
        id=str(uuid.uuid4()),
        account_id=data.account_id,
        type=data.type,
        peer_jid=data.peer_jid,
        title=data.title,
        avatar_url=data.avatar_url,
        unread_count=0,
        pinned=False,
        archived=False,
    )
    db.add(conv)
    await db.commit()
    await db.refresh(conv)
    return conv


@router.patch("/{conv_id}/pin")
async def pin_conversation(conv_id: str, pinned: bool, db: AsyncSession = Depends(get_db)):
    await db.execute(update(Conversation).where(Conversation.id == conv_id).values(pinned=pinned))
    await db.commit()
    return {"ok": True}


@router.patch("/{conv_id}/archive")
async def archive_conversation(conv_id: str, archived: bool, db: AsyncSession = Depends(get_db)):
    await db.execute(update(Conversation).where(Conversation.id == conv_id).values(archived=archived))
    await db.commit()
    return {"ok": True}


@router.patch("/{conv_id}/read")
async def mark_read(conv_id: str, db: AsyncSession = Depends(get_db)):
    await db.execute(update(Conversation).where(Conversation.id == conv_id).values(unread_count=0))
    await db.commit()
    return {"ok": True}
