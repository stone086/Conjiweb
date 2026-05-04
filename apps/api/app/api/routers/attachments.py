from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional
from app.core.database import get_db
from app.core.config import settings
from app.models import Attachment
from app.utils.security import get_current_user
from minio import Minio
from minio.error import S3Error
import uuid, io
try:
    import magic
except Exception:  # pragma: no cover
    magic = None

router = APIRouter()

minio_client = Minio(
    settings.MINIO_ENDPOINT,
    access_key=settings.MINIO_ACCESS_KEY,
    secret_key=settings.MINIO_SECRET_KEY,
    secure=settings.MINIO_SECURE,
)

ALLOWED_MIME_TYPES = {
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "audio/webm",
    "video/webm",
    "audio/ogg",
    "audio/mpeg",
    "audio/mp4",
    "audio/wav",
    "application/pdf",
    "application/zip",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
}
MAX_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024


def ensure_bucket():
    try:
        if not minio_client.bucket_exists(settings.MINIO_BUCKET):
            minio_client.make_bucket(settings.MINIO_BUCKET)
    except Exception:
        pass


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
    message_id: Optional[str] = None,
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
        raise HTTPException(status_code=413, detail="File too large")
    if magic is None:
        raise HTTPException(status_code=500, detail="MIME detection is unavailable on server")
    detected_mime = magic.from_buffer(content, mime=True) or "application/octet-stream"
    if detected_mime not in ALLOWED_MIME_TYPES:
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

    return UploadResponse(
        id=file_id,
        object_key=object_key,
        download_url=download_url,
        file_name=safe_name,
        mime_type=detected_mime,
        size_bytes=size,
    )


@router.get(
    "/presign/{object_key:path}",
    summary="Get presigned URL",
    description="Return temporary signed download URL for one object key.",
)
async def get_presigned_url(
    object_key: str,
    _current_user: dict[str, str] = Depends(get_current_user),
):
    try:
        url = minio_client.presigned_get_object(settings.MINIO_BUCKET, object_key)
        return {"url": url}
    except S3Error as e:
        raise HTTPException(status_code=404, detail=str(e))
