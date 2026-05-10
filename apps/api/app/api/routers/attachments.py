from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional
import logging
from app.core.database import get_db
from app.core.config import settings
from app.models import Attachment, Conversation, Message
from app.utils.security import get_current_user, decode_token
from minio import Minio
from minio.error import S3Error
import uuid, io
try:
    import magic
except Exception:  # pragma: no cover
    magic = None

router = APIRouter()
logger = logging.getLogger("conjiweb.attachments")

minio_client = Minio(
    settings.MINIO_ENDPOINT,
    access_key=settings.MINIO_ACCESS_KEY,
    secret_key=settings.MINIO_SECRET_KEY,
    secure=settings.MINIO_SECURE,
)

# Allowed MIME types for upload. application/octet-stream is included so that
# OMEMO Media Sharing (XEP-0454) clients can upload AES-GCM-encrypted blobs;
# the decrypted content type is enforced client-side via the URL fragment.
ALLOWED_MIME_TYPES = {
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/heic",
    "image/heif",
    "audio/webm",
    "video/webm",
    "video/mp4",
    "video/quicktime",
    "audio/ogg",
    "audio/mpeg",
    "audio/mp4",
    "audio/wav",
    "audio/x-m4a",
    "application/pdf",
    "application/zip",
    "application/octet-stream",  # encrypted (aesgcm://) blobs
    "text/plain",
}
MAX_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024


def ensure_bucket():
    try:
        if not minio_client.bucket_exists(settings.MINIO_BUCKET):
            minio_client.make_bucket(settings.MINIO_BUCKET)
    except Exception as e:
        logger.warning(f"ensure_bucket_failed: {type(e).__name__}: {e}")


class UploadResponse(BaseModel):
    id: str
    object_key: str
    download_url: str
    file_name: str
    mime_type: str
    size_bytes: int


@router.post(
    "/upload",
    response_model=UploadResponse,
    summary="Upload attachment",
    description="Validate MIME and size, store file in MinIO, and persist metadata.",
)
async def upload_file(
    file: UploadFile = File(...),
    # message_id MUST use Form() so FastAPI parses it from the multipart body.
    # Without Form(), FastAPI treats it as a query parameter, which mismatches
    # how the frontend sends it (inside FormData) and produces obscure 422s.
    message_id: Optional[str] = Form(None),
    _current_user: dict[str, str] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ensure_bucket()
    file_id = str(uuid.uuid4())
    # Sanitize filename: strip path components, limit characters
    raw_name = file.filename or "unnamed"
    safe_name = raw_name.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]  # strip path
    safe_name = "".join(c for c in safe_name if c.isalnum() or c in "._- ").strip()
    safe_name = safe_name[:200] or "file"
    ext = safe_name.rsplit(".", 1)[-1] if "." in safe_name else "bin"
    object_key = f"uploads/{file_id}.{ext}"

    content = await file.read()
    size = len(content)
    if size == 0:
        raise HTTPException(status_code=400, detail="Empty file")
    if size > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 100MB)")
    if magic is None:
        # libmagic not installed — fall back to client-declared content_type.
        # Less safe but better than silent 500 in environments without libmagic1.
        detected_mime = (file.content_type or "application/octet-stream").lower()
        logger.warning("libmagic_unavailable_using_client_content_type")
    else:
        detected_mime = magic.from_buffer(content, mime=True) or "application/octet-stream"

    if detected_mime not in ALLOWED_MIME_TYPES:
        logger.info(f"upload_rejected_mime detected={detected_mime} name={safe_name}")
        raise HTTPException(status_code=415, detail=f"Unsupported file type: {detected_mime}")

    try:
        minio_client.put_object(
            settings.MINIO_BUCKET,
            object_key,
            io.BytesIO(content),
            length=size,
            content_type=detected_mime,
        )
    except S3Error as e:
        logger.error(f"minio_put_failed key={object_key} error={e}")
        raise HTTPException(status_code=500, detail=f"Storage error: {e}")

    download_url = f"https://{settings.PUBLIC_DOMAIN}/files/{object_key}"

    attachment = Attachment(
        id=file_id,
        message_id=message_id,
        object_key=object_key,
        file_name=safe_name,
        mime_type=detected_mime,
        size_bytes=size,
        download_url=download_url,
    )
    db.add(attachment)
    await db.commit()

    logger.info(f"upload_ok id={file_id} mime={detected_mime} size={size} name={safe_name}")
    return UploadResponse(
        id=file_id,
        object_key=object_key,
        download_url=download_url,
        file_name=safe_name,
        mime_type=detected_mime,
        size_bytes=size,
    )


async def _user_can_access_object(
    db: AsyncSession,
    object_key: str,
    actor: dict[str, str],
) -> bool:
    """Check if the given user has the right to read this MinIO object.

    Admins can access anything. Users can access an object only if it is
    referenced by an attachment whose message belongs to a conversation
    that belongs to their account.
    """
    if actor.get("role") == "admin":
        return True
    user_account_id = actor.get("account_id")
    if not user_account_id:
        return False

    # Find the attachment by object_key
    stmt = (
        select(Conversation.account_id)
        .join(Message, Message.id == Attachment.message_id)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(Attachment.object_key == object_key)
    )
    result = await db.execute(stmt)
    owner_account_id = result.scalar_one_or_none()

    # Allow attachments not yet linked to a message (just-uploaded, message
    # hasn't been indexed yet) — only by the uploader, but we don't track
    # uploader-id directly. Best we can do: time-limit the unowned access
    # by checking the attachment age. For safety, deny by default here.
    if owner_account_id is None:
        # Unattached: only allow within first 5 minutes after upload to handle
        # the upload->message-emit race; otherwise deny.
        from datetime import datetime, timedelta, UTC
        age_stmt = select(Attachment.created_at).where(Attachment.object_key == object_key)
        age_result = await db.execute(age_stmt)
        created_at = age_result.scalar_one_or_none()
        if created_at is None:
            return False
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=UTC)
        return (datetime.now(UTC) - created_at) < timedelta(minutes=5)

    return owner_account_id == user_account_id


@router.get(
    "/presign/{object_key:path}",
    summary="Get presigned URL",
    description="Return temporary signed download URL for one object key. "
                "Caller must own the conversation containing this attachment.",
)
async def get_presigned_url(
    object_key: str,
    actor: dict[str, str] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not await _user_can_access_object(db, object_key, actor):
        # Use 404 not 403 so we don't leak whether the object exists
        raise HTTPException(status_code=404, detail="Not found")
    try:
        url = minio_client.presigned_get_object(settings.MINIO_BUCKET, object_key)
        return {"url": url}
    except S3Error as e:
        raise HTTPException(status_code=404, detail=str(e))


def _actor_from_download_request(request: Request) -> dict[str, str]:
    auth_header = request.headers.get("Authorization", "")
    token = ""
    if auth_header.startswith("Bearer "):
        token = auth_header[len("Bearer "):]
    if not token:
        token = request.query_params.get("t", "")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    payload = decode_token(token)
    role = payload.get("role")
    account_id = payload.get("account_id")
    if role not in ("admin", "user"):
        raise HTTPException(status_code=403, detail="Invalid token role")
    if role == "user" and not account_id:
        raise HTTPException(status_code=403, detail="Invalid user token payload")
    return {"role": role, "account_id": account_id, "sub": payload.get("sub", "")}


@router.get(
    "/download/{object_key:path}",
    summary="Download attachment",
    description="Stream a private MinIO object after token-based ownership checks.",
)
async def download_file(
    object_key: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    actor = _actor_from_download_request(request)
    if not await _user_can_access_object(db, object_key, actor):
        raise HTTPException(status_code=404, detail="Not found")

    stmt = select(Attachment).where(Attachment.object_key == object_key)
    result = await db.execute(stmt)
    attachment = result.scalar_one_or_none()
    media_type = attachment.mime_type if attachment else "application/octet-stream"
    file_name = attachment.file_name if attachment else object_key.rsplit("/", 1)[-1]

    try:
        obj = minio_client.get_object(settings.MINIO_BUCKET, object_key)
    except S3Error as e:
        raise HTTPException(status_code=404, detail=str(e))

    def stream_object():
        try:
            yield from obj.stream(32 * 1024)
        finally:
            obj.close()
            obj.release_conn()

    safe_download_name = file_name.replace('"', "")
    return StreamingResponse(
        stream_object(),
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{safe_download_name}"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


@router.get(
    "/auth-check",
    summary="nginx auth_request endpoint for /files/* downloads",
    description="Returns 200 if the bearer token in the Authorization header "
                "(or query string) is allowed to read X-Original-URI's object_key. "
                "Used by nginx auth_request to gate MinIO proxy access. "
                "Returns 401/403/404 to deny.",
    include_in_schema=False,
)
async def auth_check(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    # nginx passes the original URI (e.g. "/files/uploads/abc123.jpg") via header
    original_uri = request.headers.get("X-Original-URI", "")
    # Strip the "/files/" prefix to match how object_key is stored in DB
    if not original_uri.startswith("/files/"):
        return Response(status_code=404)
    object_key = original_uri[len("/files/"):].split("?", 1)[0]
    if not object_key:
        return Response(status_code=404)

    # Extract token: prefer Authorization header, fall back to ?t= query param
    # (so <img src> tags can include it without setting headers).
    auth_header = request.headers.get("Authorization", "")
    token = ""
    if auth_header.startswith("Bearer "):
        token = auth_header[len("Bearer "):]
    if not token:
        token = request.query_params.get("t", "")
    if not token:
        return Response(status_code=401)

    try:
        payload = decode_token(token)
    except HTTPException:
        return Response(status_code=401)

    role = payload.get("role")
    account_id = payload.get("account_id")
    if role not in ("admin", "user"):
        return Response(status_code=403)
    if role == "user" and not account_id:
        return Response(status_code=403)

    actor = {"role": role, "account_id": account_id, "sub": payload.get("sub", "")}
    allowed = await _user_can_access_object(db, object_key, actor)
    return Response(status_code=200 if allowed else 404)
