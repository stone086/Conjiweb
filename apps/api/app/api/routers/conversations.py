from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, List
from app.core.database import get_db
from app.models import Conversation, Message
import uuid

router = APIRouter()


class ConversationCreate(BaseModel):
    account_id: str = Field(..., min_length=1, max_length=64)
    type: str = Field(..., max_length=16)  # private/group/system
    peer_jid: str = Field(..., min_length=3, max_length=130)
    title: Optional[str] = Field(None, max_length=256)
    avatar_url: Optional[str] = Field(None, max_length=2048)


class ConversationResponse(BaseModel):
    id: str
    account_id: str
    type: str
    peer_jid: str
    title: Optional[str]
    unread_count: int
    pinned: bool
    archived: bool

    model_config = ConfigDict(from_attributes=True)


@router.get(
    "/",
    response_model=List[ConversationResponse],
    summary="List conversations",
    description="List active (non-archived) conversations for an account.",
)
async def list_conversations(account_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Conversation)
        .where(Conversation.account_id == account_id, Conversation.archived == False)
        .order_by(Conversation.last_message_at.desc())
    )
    return result.scalars().all()


@router.post(
    "/",
    response_model=ConversationResponse,
    summary="Create or get conversation",
    description="Return existing conversation for peer JID or create a new one.",
)
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


@router.patch(
    "/{conv_id}/pin",
    summary="Pin conversation",
    description="Set pinned status on a conversation.",
)
async def pin_conversation(conv_id: str, pinned: bool, db: AsyncSession = Depends(get_db)):
    await db.execute(update(Conversation).where(Conversation.id == conv_id).values(pinned=pinned))
    await db.commit()
    return {"ok": True}


@router.patch(
    "/{conv_id}/archive",
    summary="Archive conversation",
    description="Set archived status on a conversation.",
)
async def archive_conversation(conv_id: str, archived: bool, db: AsyncSession = Depends(get_db)):
    await db.execute(update(Conversation).where(Conversation.id == conv_id).values(archived=archived))
    await db.commit()
    return {"ok": True}


@router.patch(
    "/{conv_id}/read",
    summary="Mark conversation read",
    description="Reset unread counter for a conversation.",
)
async def mark_read(conv_id: str, db: AsyncSession = Depends(get_db)):
    await db.execute(update(Conversation).where(Conversation.id == conv_id).values(unread_count=0))
    await db.commit()
    return {"ok": True}
