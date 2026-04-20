import asyncio
import socket

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.core.database import get_db
from app.models import AuditLog, Account, Message, Attachment
from app.core.config import settings
from app.core.version import get_app_version
from minio import Minio
import redis.asyncio as redis

router = APIRouter()
APP_VERSION = get_app_version()


@router.get(
    "/status",
    summary="System status",
    description="Return high-level system status and entity counters.",
)
async def system_status(db: AsyncSession = Depends(get_db)):
    account_count = await db.scalar(select(func.count()).select_from(Account))
    message_count = await db.scalar(select(func.count()).select_from(Message))
    attachment_count = await db.scalar(select(func.count()).select_from(Attachment))
    return {
        "status": "healthy",
        "version": APP_VERSION,
        "stats": {
            "accounts": account_count,
            "messages": message_count,
            "attachments": attachment_count,
        },
    }


@router.get(
    "/audit-logs",
    summary="Audit logs",
    description="Return paginated audit log entries.",
)
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


async def _tcp_check(host: str, port: int, timeout: float = 1.5) -> bool:
    try:
        fut = asyncio.open_connection(host, port)
        reader, writer = await asyncio.wait_for(fut, timeout=timeout)
        writer.close()
        await writer.wait_closed()
        return True
    except Exception:
        return False


@router.get(
    "/service-health",
    summary="Service health",
    description="Check runtime health of DB, Redis, MinIO, and Prosody dependencies.",
)
async def service_health(db: AsyncSession = Depends(get_db)):
    services = []

    # API/database health
    db_ok = True
    try:
        await db.execute(select(1))
    except Exception:
        db_ok = False

    # Redis
    redis_ok = False
    try:
        redis_client = redis.from_url(settings.REDIS_URL)
        redis_ok = bool(await redis_client.ping())
        await redis_client.aclose()
    except Exception:
        redis_ok = False

    # MinIO
    minio_ok = False
    try:
        minio_client = Minio(
            settings.MINIO_ENDPOINT,
            access_key=settings.MINIO_ACCESS_KEY,
            secret_key=settings.MINIO_SECRET_KEY,
            secure=settings.MINIO_SECURE,
        )
        minio_ok = bool(minio_client.bucket_exists(settings.MINIO_BUCKET))
    except Exception:
        minio_ok = False

    # Prosody checks (c2s and http/websocket ports on localhost)
    prosody_5222 = await _tcp_check("127.0.0.1", 5222)
    prosody_5280 = await _tcp_check("127.0.0.1", 5280)
    prosody_ok = prosody_5222 or prosody_5280

    services.append({"name": "api", "label": "FastAPI Backend", "ok": True, "detail": "process is serving this endpoint"})
    services.append({"name": "postgresql", "label": "PostgreSQL", "ok": db_ok, "detail": "database query check"})
    services.append({"name": "redis", "label": "Redis", "ok": redis_ok, "detail": "redis ping"})
    services.append({"name": "minio", "label": "MinIO", "ok": minio_ok, "detail": f"bucket check: {settings.MINIO_BUCKET}"})
    services.append({"name": "prosody", "label": "Prosody XMPP", "ok": prosody_ok, "detail": "tcp check 5222/5280"})

    overall = "healthy" if all(item["ok"] for item in services) else "degraded"
    return {"status": overall, "services": services}
