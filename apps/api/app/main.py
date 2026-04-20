from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.core.config import settings
from app.core.database import engine, Base
from app.core.rate_limit import limiter
from app.utils.security import get_current_admin
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
    title="Conjiweb API",
    version="3.0.0",
    description="Backend API for Conjiweb 鈥?Modern Web XMPP Client Platform",
    lifespan=lifespan,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

admin_dep = [Depends(get_current_admin)]

app.include_router(auth.router,          prefix="/auth",           tags=["auth"])
app.include_router(accounts.router,      prefix="/accounts",       tags=["accounts"], dependencies=admin_dep)
app.include_router(conversations.router, prefix="/conversations",  tags=["conversations"], dependencies=admin_dep)
app.include_router(contacts.router,      prefix="/contacts",       tags=["contacts"], dependencies=admin_dep)
app.include_router(attachments.router,   prefix="/attachments",    tags=["attachments"], dependencies=admin_dep)
app.include_router(messages.router,      prefix="/messages",       tags=["messages"], dependencies=admin_dep)
app.include_router(plugins.router,       prefix="/plugins",        tags=["plugins"], dependencies=admin_dep)
app.include_router(ai.router,            prefix="/ai",             tags=["ai"], dependencies=admin_dep)
app.include_router(admin.router,         prefix="/admin",          tags=["admin"], dependencies=admin_dep)


@app.get("/health")
async def health_check():
    return {"status": "ok", "version": "3.0.0"}


@app.get("/api/health")
async def api_health_check():
    return {"status": "ok", "version": "3.0.0"}

# WebSocket
from app.api.routers import websocket as ws_router
app.include_router(ws_router.router, tags=["realtime"])
