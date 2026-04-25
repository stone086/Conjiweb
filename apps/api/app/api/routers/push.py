"""
push.py - Web Push notification endpoint.

Receives push subscriptions from PWA frontend and forwards XMPP push
notifications (XEP-0357) to the browser via the Web Push protocol.

Architecture:
  Prosody (mod_cloud_notify) → POST /push/notify → Web Push → Browser SW
                                       ↑
  PWA frontend → POST /push/subscribe (registers endpoint)
"""
from fastapi import APIRouter, Depends, HTTPException, Body
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from typing import Optional
import json
import os

from app.core.database import get_db
from app.models import PushSubscription
from app.utils.security import get_current_user

router = APIRouter()


class PushSubscriptionRequest(BaseModel):
    endpoint: str
    p256dh: str
    auth: str
    user_agent: Optional[str] = None


class PushNotifyRequest(BaseModel):
    """Internal endpoint called by Prosody mod_cloud_notify."""
    account_jid: str
    title: str
    body: str
    badge: Optional[int] = None
    secret: str  # shared secret to authenticate Prosody


@router.post("/push/subscribe")
async def subscribe(
    payload: PushSubscriptionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Register a Web Push subscription for the current user."""
    account_id = current_user.get("account_id")
    if not account_id:
        raise HTTPException(status_code=403, detail="User token required")

    # Upsert: replace any existing subscription for same endpoint
    await db.execute(
        delete(PushSubscription).where(PushSubscription.endpoint == payload.endpoint)
    )
    sub = PushSubscription(
        account_id=account_id,
        endpoint=payload.endpoint,
        p256dh=payload.p256dh,
        auth=payload.auth,
        user_agent=payload.user_agent,
    )
    db.add(sub)
    await db.commit()
    return {"status": "ok"}


@router.delete("/push/unsubscribe")
async def unsubscribe(
    endpoint: str = Body(..., embed=True),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Remove a Web Push subscription."""
    await db.execute(
        delete(PushSubscription).where(PushSubscription.endpoint == endpoint)
    )
    await db.commit()
    return {"status": "ok"}


@router.post("/push/notify", include_in_schema=False)
async def notify(
    payload: PushNotifyRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Internal endpoint called by Prosody (XEP-0357) when an XMPP push
    notification needs to be relayed to the user's PWA.

    Authenticated by shared secret (PUSH_SHARED_SECRET env), not JWT.
    """
    expected = os.getenv("PUSH_SHARED_SECRET")
    if not expected or payload.secret != expected:
        raise HTTPException(status_code=403, detail="Invalid push secret")

    # Find subscriptions for the target account
    from app.models import Account
    result = await db.execute(
        select(Account).where(Account.jid == payload.account_jid)
    )
    account = result.scalar_one_or_none()
    if not account:
        return {"status": "no_account"}

    result = await db.execute(
        select(PushSubscription).where(PushSubscription.account_id == account.id)
    )
    subs = result.scalars().all()
    if not subs:
        return {"status": "no_subscriptions"}

    # Send Web Push to each subscription
    try:
        from pywebpush import webpush, WebPushException
    except ImportError:
        # pywebpush not installed; log and skip
        return {"status": "pywebpush_missing"}

    vapid_private_key = os.getenv("VAPID_PRIVATE_KEY")
    vapid_email = os.getenv("VAPID_EMAIL", "admin@conjiweb.local")
    if not vapid_private_key:
        return {"status": "vapid_not_configured"}

    notify_payload = json.dumps({
        "title": payload.title,
        "body": payload.body,
        "badge": payload.badge,
        "tag": "conjiweb-msg",
    })

    sent = 0
    failed_endpoints = []
    for sub in subs:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                },
                data=notify_payload,
                vapid_private_key=vapid_private_key,
                vapid_claims={"sub": f"mailto:{vapid_email}"},
            )
            sent += 1
        except WebPushException as exc:
            # 410 = subscription expired/revoked
            if exc.response and exc.response.status_code in (404, 410):
                failed_endpoints.append(sub.endpoint)
        except Exception:
            pass

    # Clean up dead subscriptions
    if failed_endpoints:
        await db.execute(
            delete(PushSubscription).where(
                PushSubscription.endpoint.in_(failed_endpoints)
            )
        )
        await db.commit()

    return {"status": "ok", "sent": sent, "removed": len(failed_endpoints)}


@router.get("/push/vapid-public-key")
async def get_vapid_public_key():
    """Public endpoint - frontend needs the VAPID public key to subscribe."""
    return {"key": os.getenv("VAPID_PUBLIC_KEY", "")}
