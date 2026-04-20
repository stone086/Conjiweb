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


class AccountPreferenceResponse(BaseModel):
    auto_login: bool
    default_presence: str
    theme_override: Optional[str] = None
    notifications_enabled: bool
    config_json: dict


class AccountPreferenceUpdate(BaseModel):
    auto_login: Optional[bool] = None
    default_presence: Optional[str] = None
    theme_override: Optional[str] = None
    notifications_enabled: Optional[bool] = None
    config_json: Optional[dict] = None


@router.get(
    "/",
    response_model=List[AccountResponse],
    summary="List enabled accounts",
    description="Return all enabled local accounts.",
)
async def list_accounts(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Account).where(Account.is_enabled == True))
    return result.scalars().all()


@router.post(
    "/",
    response_model=AccountResponse,
    summary="Create account",
    description="Create a local account record and default preference profile.",
)
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


@router.get(
    "/{account_id}",
    response_model=AccountResponse,
    summary="Get account",
    description="Fetch one account by id.",
)
async def get_account(account_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Account).where(Account.id == account_id))
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return account


@router.delete(
    "/{account_id}",
    summary="Disable account",
    description="Soft-delete an account by setting is_enabled to false.",
)
async def delete_account(account_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Account).where(Account.id == account_id))
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    account.is_enabled = False
    await db.commit()
    return {"ok": True}


@router.get(
    "/{account_id}/preferences",
    response_model=AccountPreferenceResponse,
    summary="Get account preferences",
    description="Return account-level preference settings, creating defaults when missing.",
)
async def get_account_preferences(account_id: str, db: AsyncSession = Depends(get_db)):
    account_result = await db.execute(select(Account).where(Account.id == account_id))
    account = account_result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    result = await db.execute(select(AccountPreference).where(AccountPreference.account_id == account_id))
    pref = result.scalar_one_or_none()
    if not pref:
        pref = AccountPreference(account_id=account_id)
        db.add(pref)
        await db.commit()
        await db.refresh(pref)
    return pref


@router.put(
    "/{account_id}/preferences",
    response_model=AccountPreferenceResponse,
    summary="Update account preferences",
    description="Patch account preference fields and return the saved profile.",
)
async def update_account_preferences(account_id: str, data: AccountPreferenceUpdate, db: AsyncSession = Depends(get_db)):
    account_result = await db.execute(select(Account).where(Account.id == account_id))
    account = account_result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    result = await db.execute(select(AccountPreference).where(AccountPreference.account_id == account_id))
    pref = result.scalar_one_or_none()
    if not pref:
        pref = AccountPreference(account_id=account_id)
        db.add(pref)

    patch = data.model_dump(exclude_unset=True)
    for key, value in patch.items():
        setattr(pref, key, value)

    await db.commit()
    await db.refresh(pref)
    return pref
