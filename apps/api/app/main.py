import logging
import sys
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.api.routers import (
    accounts,
    admin,
    ai,
    attachments,
    auth,
    calls,
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


# ---------------------------------------------------------------------------
# Logging setup — structured logs to stderr (systemd journal will pick up)
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s | %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stderr,
)
logger = logging.getLogger("conjiweb")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"Conjiweb API starting (version {get_app_version()})")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    logger.info("Conjiweb API shutting down")
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
        {"name": "calls", "description": "Call history APIs. User token required."},
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
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With"],
)


@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    """Attach a request ID, log timing, and catch unhandled exceptions."""
    request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:12]
    request.state.request_id = request_id
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception as exc:
        elapsed_ms = (time.perf_counter() - start) * 1000
        logger.error(
            f"request_failed id={request_id} method={request.method} path={request.url.path} "
            f"error={type(exc).__name__}: {exc} elapsed_ms={elapsed_ms:.1f}",
            exc_info=True,
        )
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error", "request_id": request_id},
            headers={"X-Request-ID": request_id},
        )
    elapsed_ms = (time.perf_counter() - start) * 1000
    response.headers["X-Request-ID"] = request_id
    # Only log slow requests or errors at INFO; debug for normal traffic
    if response.status_code >= 500 or elapsed_ms > 1000:
        logger.warning(
            f"slow_or_error id={request_id} method={request.method} path={request.url.path} "
            f"status={response.status_code} elapsed_ms={elapsed_ms:.1f}"
        )
    elif response.status_code >= 400:
        logger.info(
            f"request_4xx id={request_id} method={request.method} path={request.url.path} "
            f"status={response.status_code} elapsed_ms={elapsed_ms:.1f}"
        )
    return response

admin_dep = [Depends(get_current_admin)]

app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(accounts.router, prefix="/accounts", tags=["accounts"], dependencies=admin_dep)
app.include_router(conversations.router, prefix="/conversations", tags=["conversations"], dependencies=admin_dep)
app.include_router(contacts.router, prefix="/contacts", tags=["contacts"], dependencies=admin_dep)
app.include_router(attachments.router, prefix="/attachments", tags=["attachments"])
app.include_router(calls.router, tags=["calls"])
app.include_router(messages.router, prefix="/messages", tags=["messages"])
app.include_router(plugins.router, prefix="/plugins", tags=["plugins"])
app.include_router(ai.router, prefix="/ai", tags=["ai"])
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
