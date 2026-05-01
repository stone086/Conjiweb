from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.core.rate_limit import limiter

router = APIRouter()

WEB_VITAL_NAMES = {"LCP", "FID", "CLS", "INP", "TTFB"}
_WEB_VITALS_MAX = 5000
_web_vitals_buffer: list[dict] = []


class WebVitalReport(BaseModel):
    name: str
    value: float
    rating: str
    url: str
    timestamp: int


class WebVitalsBatch(BaseModel):
    reports: list[WebVitalReport]


@router.post(
    "/metrics/web-vitals",
    include_in_schema=False,
)
@limiter.limit("30/minute")
async def collect_web_vitals(request: Request, batch: WebVitalsBatch):
    for report in batch.reports:
        if report.name not in WEB_VITAL_NAMES:
            continue
        _web_vitals_buffer.append(
            {
                "name": report.name,
                "value": report.value,
                "rating": report.rating,
                "url": report.url[:2048],
                "timestamp": report.timestamp,
            }
        )
    if len(_web_vitals_buffer) > _WEB_VITALS_MAX:
        del _web_vitals_buffer[: len(_web_vitals_buffer) - _WEB_VITALS_MAX]
    return {"received": len(batch.reports)}


def web_vitals_summary() -> dict[str, dict]:
    summary: dict[str, dict] = {}
    for metric in WEB_VITAL_NAMES:
        values = sorted(r["value"] for r in _web_vitals_buffer if r["name"] == metric)
        if not values:
            continue
        summary[metric] = {
            "count": len(values),
            "p50": round(_percentile(values, 0.50), 2),
            "p75": round(_percentile(values, 0.75), 2),
            "p95": round(_percentile(values, 0.95), 2),
        }
    return summary


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0
    index = min(round((len(values) - 1) * percentile), len(values) - 1)
    return values[index]
