from sqlalchemy.ext.asyncio import AsyncSession
from app.models import AuditLog
import uuid


async def write_audit(
    db: AsyncSession,
    actor: str,
    action: str,
    target_type: str = None,
    target_id: str = None,
    detail: dict = None,
):
    log = AuditLog(
        id=str(uuid.uuid4()),
        actor=actor,
        action=action,
        target_type=target_type,
        target_id=target_id,
        detail_json=detail or {},
    )
    db.add(log)
    await db.commit()
