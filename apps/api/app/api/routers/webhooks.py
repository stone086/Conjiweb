"""
webhooks.py - Inbound webhook endpoints.

External services can POST messages into a Conjiweb conversation:
  POST /webhooks/{webhook_id}
  {
    "message": "Build #1234 succeeded on main",
    "username": "ci-bot",         # display name for this message
    "icon_emoji": ":white_check_mark:"  # optional avatar emoji
  }

Each webhook is bound to a specific conversation (group or 1:1).
Admins generate webhooks via the admin panel and share the URL with
the external service (Jenkins, GitLab, Sentry, etc).

Authenticated by the random webhook_id token in the URL itself.
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
import secrets

from app.core.database import get_db
from app.models import Webhook, Conversation, Message, gen_uuid
from app.utils.security import get_current_admin

router = APIRouter()


class WebhookCreate(BaseModel):
    name: str
    conversation_id: str


class WebhookOut(BaseModel):
    id: str
    name: str
    conversation_id: str
    token: str
    url: str


class WebhookPost(BaseModel):
    message: str
    username: Optional[str] = None
    icon_emoji: Optional[str] = None


@router.post("/webhooks", response_model=WebhookOut, dependencies=[Depends(get_current_admin)])
async def create_webhook(
    payload: WebhookCreate,
    db: AsyncSession = Depends(get_db),
):
    """Admin: generate a new inbound webhook URL for a conversation."""
    conv = (await db.execute(
        select(Conversation).where(Conversation.id == payload.conversation_id)
    )).scalar_one_or_none()
    if not conv:
        raise HTTPException(404, "Conversation not found")

    token = secrets.token_urlsafe(32)
    wh_id = gen_uuid()
    wh = Webhook(id=wh_id, name=payload.name, conversation_id=conv.id, token=token)
    db.add(wh)
    await db.commit()

    return WebhookOut(
        id=wh.id,
        name=wh.name,
        conversation_id=conv.id,
        token=token,
        url=f"/webhooks/{wh.id}/{token}",
    )


@router.get("/webhooks", dependencies=[Depends(get_current_admin)])
async def list_webhooks(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Webhook))
    return [
        {"id": w.id, "name": w.name, "conversation_id": w.conversation_id}
        for w in result.scalars().all()
    ]


@router.delete("/webhooks/{webhook_id}", dependencies=[Depends(get_current_admin)])
async def delete_webhook(webhook_id: str, db: AsyncSession = Depends(get_db)):
    wh = (await db.execute(
        select(Webhook).where(Webhook.id == webhook_id)
    )).scalar_one_or_none()
    if not wh:
        raise HTTPException(404, "Webhook not found")
    await db.delete(wh)
    await db.commit()
    return {"status": "deleted"}


@router.post("/webhooks/{webhook_id}/{token}", include_in_schema=False)
async def trigger_webhook(
    webhook_id: str,
    token: str,
    payload: WebhookPost,
    db: AsyncSession = Depends(get_db),
):
    """
    Public endpoint - triggered by external services.
    Authenticated by webhook_id + token combination.
    """
    wh = (await db.execute(
        select(Webhook).where(Webhook.id == webhook_id)
    )).scalar_one_or_none()
    if not wh or not secrets.compare_digest(wh.token, token):
        raise HTTPException(401, "Invalid webhook")

    # Insert as a system-style message in the conversation
    sender_name = payload.username or wh.name
    body = payload.message
    if payload.icon_emoji:
        body = f"{payload.icon_emoji} {body}"

    msg = Message(
        id=gen_uuid(),
        conversation_id=wh.conversation_id,
        sender_jid=f"webhook:{sender_name}",
        body=body,
        direction="in",
        status="delivered",
    )
    db.add(msg)
    await db.commit()
    return {"status": "ok"}
