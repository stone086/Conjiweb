from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional, List
from app.core.database import get_db
from app.models import Account, AccountPreference
import uuid

router = APIRouter()


class AccountCreate(BaseModel):
    jid: str
    domain: str
    display_name: Optional[str] = None


class AccountResponse(BaseModel):
    id: str
    jid: str
    domain: str
    display_name: Optional[str]
    is_enabled: bool

    class Config:
        from_attributes = True


@router.get("/", response_model=List[AccountResponse])
async def list_accounts(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Account).where(Account.is_enabled == True))
    return result.scalars().all()


@router.post("/", response_model=AccountResponse)
async def create_account(data: AccountCreate, db: AsyncSession = Depends(get_db)):
    account = Account(
        id=str(uuid.uuid4()),
        jid=data.jid,
        domain=data.domain,
        display_name=data.display_name,
    )
    db.add(account)
    pref = AccountPreference(account_id=account.id)
    db.add(pref)
    await db.commit()
    await db.refresh(account)
    return account


@router.get("/{account_id}", response_model=AccountResponse)
async def get_account(account_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Account).where(Account.id == account_id))
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return account


@router.delete("/{account_id}")
async def delete_account(account_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Account).where(Account.id == account_id))
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    account.is_enabled = False
    await db.commit()
    return {"ok": True}
