from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from pydantic import BaseModel
from typing import List, Optional
from app.core.database import get_db
from app.models import Message, Conversation
import uuid

router = APIRouter()


class MessageCreate(BaseModel):
    conversation_id: str
    sender_jid: str
    receiver_jid: Optional[str]
    body: str
    body_type: str = "text"
    direction: str
    xmpp_stanza_id: Optional[str]
    metadata_json: Optional[dict] = {}


class MessageResponse(BaseModel):
    id: str
    conversation_id: str
    sender_jid: str
    body: Optional[str]
    direction: str
    status: str
    created_at: Optional[str]

    class Config:
        from_attributes = True


@router.post("/", response_model=MessageResponse)
async def index_message(data: MessageCreate, db: AsyncSession = Depends(get_db)):
    msg = Message(
        id=str(uuid.uuid4()),
        conversation_id=data.conversation_id,
        sender_jid=data.sender_jid,
        receiver_jid=data.receiver_jid,
        body=data.body,
        body_type=data.body_type,
        direction=data.direction,
        xmpp_stanza_id=data.xmpp_stanza_id,
        metadata_json=data.metadata_json,
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)
    return msg


@router.get("/search", response_model=List[MessageResponse])
async def search_messages(
    q: str = Query(..., min_length=1),
    account_id: Optional[str] = None,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Message).where(Message.body.ilike(f"%{q}%")).limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/conversation/{conversation_id}", response_model=List[MessageResponse])
async def get_conversation_messages(
    conversation_id: str,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    result = await db.execute(stmt)
    return result.scalars().all()
