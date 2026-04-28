import os

from fastapi import APIRouter

router = APIRouter()


@router.get(
    "/config/runtime",
    summary="Public runtime configuration",
    description="Return non-sensitive feature flags and client runtime settings.",
)
async def runtime_config():
    sfu_url = os.getenv("SFU_URL", "").strip()
    return {
        "sfu_url": sfu_url or None,
        "features": {
            "sfu": bool(sfu_url),
            "passkey": False,
            "ai": bool(os.getenv("AI_API_KEY")),
            "discovery": True,
        },
    }
