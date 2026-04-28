from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.api.routers import (
    accounts,
    admin,
    ai,
    attachments,
    auth,
    contacts,
    config,
    discovery,
    conversations,
    messages,
    metrics,
    plugins,
    preview,
    push,
    sso,
    webhooks,
)
from app.core.config import settings
from app.core.database import Base, engine
from app.core.rate_limit import limiter
from app.core.version import get_app_version
from app.utils.security import get_current_admin


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()


APP_VERSION = get_app_version()

app = FastAPI(
    title="Conjiweb API",
    version=APP_VERSION,
    description="Backend API for the Conjiweb web XMPP client platform.",
    openapi_tags=[
        {"name": "auth", "description": "Authentication endpoints. Public."},
        {"name": "accounts", "description": "XMPP account management. Admin token required."},
        {"name": "conversations", "description": "Conversation metadata APIs. Admin token required."},
        {"name": "contacts", "description": "Roster and contact APIs. Admin token required."},
        {"name": "attachments", "description": "Secure attachment upload APIs. User token required."},
        {"name": "messages", "description": "Message search and indexing APIs. Admin token required."},
        {"name": "plugins", "description": "Plugin lifecycle APIs. Admin token required."},
        {"name": "ai", "description": "AI utility APIs. Admin token required."},
        {"name": "admin", "description": "System status and audit APIs. Admin token required."},
        {"name": "realtime", "description": "WebSocket realtime bridge endpoints."},
    ],
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

app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(accounts.router, prefix="/accounts", tags=["accounts"])
app.include_router(conversations.router, prefix="/conversations", tags=["conversations"], dependencies=admin_dep)
app.include_router(contacts.router, prefix="/contacts", tags=["contacts"], dependencies=admin_dep)
app.include_router(attachments.router, prefix="/attachments", tags=["attachments"])
app.include_router(messages.router, prefix="/messages", tags=["messages"])
app.include_router(plugins.router, prefix="/plugins", tags=["plugins"], dependencies=admin_dep)
app.include_router(ai.router, prefix="/ai", tags=["ai"], dependencies=admin_dep)
app.include_router(admin.router, prefix="/admin", tags=["admin"], dependencies=admin_dep)
app.include_router(push.router, tags=["push"])
app.include_router(webhooks.router, tags=["webhooks"])
app.include_router(preview.router, tags=["preview"])
app.include_router(sso.router, tags=["sso"])
app.include_router(discovery.router, tags=["discovery"])
app.include_router(config.router, tags=["config"])
app.include_router(metrics.router, tags=["metrics"])


@app.get(
    "/health",
    summary="Public liveness probe",
    description="Returns API liveness and current version.",
)
async def health_check():
    return {"status": "ok", "version": APP_VERSION}


@app.get(
    "/api/health",
    summary="Public API health probe",
    description="Nginx-routed API health endpoint.",
)
async def api_health_check():
    return {"status": "ok", "version": APP_VERSION}


# WebSocket
from app.api.routers import websocket as ws_router

app.include_router(ws_router.router, tags=["realtime"])
