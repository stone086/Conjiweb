from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from pydantic import BaseModel
from typing import Optional, List
from app.core.database import get_db
from app.models import Contact
import uuid

router = APIRouter()


class ContactUpsert(BaseModel):
    account_id: str
    jid: str
    nickname: Optional[str] = None
    group_name: Optional[str] = None
    avatar_url: Optional[str] = None


class ContactResponse(BaseModel):
    id: str
    account_id: str
    jid: str
    nickname: Optional[str]
    group_name: Optional[str]
    last_presence: Optional[str]
    is_blocked: bool

    class Config:
        from_attributes = True


@router.get("/", response_model=List[ContactResponse])
async def list_contacts(account_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Contact).where(Contact.account_id == account_id)
    )
    return result.scalars().all()


@router.post("/", response_model=ContactResponse)
async def upsert_contact(data: ContactUpsert, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Contact).where(Contact.account_id == data.account_id, Contact.jid == data.jid)
    )
    contact = result.scalar_one_or_none()
    if contact:
        contact.nickname = data.nickname or contact.nickname
        contact.group_name = data.group_name or contact.group_name
        contact.avatar_url = data.avatar_url or contact.avatar_url
    else:
        contact = Contact(
            id=str(uuid.uuid4()),
            account_id=data.account_id,
            jid=data.jid,
            nickname=data.nickname,
            group_name=data.group_name,
            avatar_url=data.avatar_url,
            is_blocked=False,
        )
        db.add(contact)
    await db.commit()
    await db.refresh(contact)
    return contact


@router.patch("/{contact_id}/block")
async def block_contact(contact_id: str, blocked: bool, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Contact).where(Contact.id == contact_id))
    contact = result.scalar_one_or_none()
    if not contact:
        raise HTTPException(404, "Contact not found")
    contact.is_blocked = blocked
    await db.commit()
    return {"ok": True}


@router.delete("/{contact_id}")
async def delete_contact(contact_id: str, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(Contact).where(Contact.id == contact_id))
    await db.commit()
    return {"ok": True}
