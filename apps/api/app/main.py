from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.core.config import settings
from app.core.database import engine, Base
from app.api.routers import (
    accounts, attachments, messages, plugins,
    ai, admin, auth, conversations, contacts,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()


app = FastAPI(
    title="Web Gajim V3 API",
    version="3.0.0",
    description="Backend API for Web Gajim V3 — Modern Web XMPP Client Platform",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router,          prefix="/auth",          tags=["auth"])
app.include_router(accounts.router,      prefix="/accounts",      tags=["accounts"])
app.include_router(conversations.router, prefix="/conversations",  tags=["conversations"])
app.include_router(contacts.router,      prefix="/contacts",       tags=["contacts"])
app.include_router(attachments.router,   prefix="/attachments",    tags=["attachments"])
app.include_router(messages.router,      prefix="/messages",       tags=["messages"])
app.include_router(plugins.router,       prefix="/plugins",        tags=["plugins"])
app.include_router(ai.router,            prefix="/ai",             tags=["ai"])
app.include_router(admin.router,         prefix="/admin",          tags=["admin"])


@app.get("/health")
async def health_check():
    return {"status": "ok", "version": "3.0.0"}

# WebSocket
from app.api.routers import websocket as ws_router
app.include_router(ws_router.router, tags=["realtime"])
