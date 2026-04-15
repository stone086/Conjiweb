from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.utils.security import create_access_token
import os

router = APIRouter()

ADMIN_USERNAME = os.getenv("ADMIN_USER", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASS", "admin")


class AdminLogin(BaseModel):
    username: str
    password: str


@router.post("/admin/login")
async def admin_login(data: AdminLogin):
    if data.username != ADMIN_USERNAME or data.password != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token(data.username)
    return {"access_token": token, "token_type": "bearer"}
