from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional
from app.core.database import get_db
from app.core.config import settings
from app.models import Attachment
from minio import Minio
from minio.error import S3Error
import uuid, io

router = APIRouter()

minio_client = Minio(
    settings.MINIO_ENDPOINT,
    access_key=settings.MINIO_ACCESS_KEY,
    secret_key=settings.MINIO_SECRET_KEY,
    secure=settings.MINIO_SECURE,
)


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


@router.post("/upload", response_model=UploadResponse)
async def upload_file(
    file: UploadFile = File(...),
    message_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    ensure_bucket()
    file_id = str(uuid.uuid4())
    ext = file.filename.split(".")[-1] if "." in file.filename else "bin"
    object_key = f"uploads/{file_id}.{ext}"

    content = await file.read()
    size = len(content)

    try:
        minio_client.put_object(
            settings.MINIO_BUCKET,
            object_key,
            io.BytesIO(content),
            length=size,
            content_type=file.content_type,
        )
    except S3Error as e:
        raise HTTPException(status_code=500, detail=f"Storage error: {e}")

    download_url = f"http://{settings.MINIO_ENDPOINT}/{settings.MINIO_BUCKET}/{object_key}"

    attachment = Attachment(
        id=file_id,
        message_id=message_id,
        object_key=object_key,
        file_name=file.filename,
        mime_type=file.content_type,
        size_bytes=size,
        download_url=download_url,
    )
    db.add(attachment)
    await db.commit()

    return UploadResponse(
        id=file_id,
        object_key=object_key,
        download_url=download_url,
        file_name=file.filename,
        mime_type=file.content_type,
        size_bytes=size,
    )


@router.get("/presign/{object_key:path}")
async def get_presigned_url(object_key: str):
    try:
        url = minio_client.presigned_get_object(settings.MINIO_BUCKET, object_key)
        return {"url": url}
    except S3Error as e:
        raise HTTPException(status_code=404, detail=str(e))
