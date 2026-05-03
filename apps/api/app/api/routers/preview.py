"""
preview.py - Server-side link preview generator (OG/oEmbed meta scraping).

Frontend detects URLs in messages and calls /preview?url=...
We fetch the URL server-side (bypasses browser CORS), parse Open Graph
and basic <meta> tags, and return a structured preview that the chat
bubble can render as a card.

Cached in Redis for 1 hour to avoid hammering target sites.
"""
import re
import asyncio
import time
from urllib.parse import urlparse
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.core.config import settings

router = APIRouter()


class LinkPreview(BaseModel):
    url: str
    title: Optional[str] = None
    description: Optional[str] = None
    image: Optional[str] = None
    site_name: Optional[str] = None
    favicon: Optional[str] = None


# In-process cache as a fallback if Redis is unavailable
_local_cache: dict[str, tuple[float, LinkPreview]] = {}
_CACHE_TTL = 3600.0  # 1 hour
_CACHE_MAX_ENTRIES = 1000  # Bound memory usage


def _local_cache_set(url: str, expires_at: float, preview: LinkPreview) -> None:
    """Set cache entry; if over size limit, evict expired then oldest entries."""
    now = time.time()
    if len(_local_cache) >= _CACHE_MAX_ENTRIES:
        # First, drop expired entries
        expired = [k for k, (exp, _) in _local_cache.items() if exp <= now]
        for k in expired:
            _local_cache.pop(k, None)
        # If still over limit, drop oldest (lowest expiry)
        if len(_local_cache) >= _CACHE_MAX_ENTRIES:
            sorted_items = sorted(_local_cache.items(), key=lambda kv: kv[1][0])
            for k, _ in sorted_items[: len(_local_cache) - _CACHE_MAX_ENTRIES + 1]:
                _local_cache.pop(k, None)
    _local_cache[url] = (expires_at, preview)


async def _looks_safe(url: str) -> bool:
    """Reject internal/loopback URLs to prevent SSRF (including DNS rebinding)."""
    import ipaddress
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        host = (parsed.hostname or "").lower()
        if not host:
            return False
        # Block obvious private hostnames
        if host in ("localhost", "127.0.0.1", "0.0.0.0", "::1"):
            return False
        if host.endswith(".local") or host.endswith(".internal"):
            return False
        # Resolve hostname (non-blocking) and check the actual IP address
        # This blocks DNS rebinding attacks where a public hostname
        # resolves to a private IP
        try:
            loop = asyncio.get_event_loop()
            infos = await loop.getaddrinfo(host, None, type=1)  # SOCK_STREAM=1
            for family, _, _, _, sockaddr in infos:
                ip = ipaddress.ip_address(sockaddr[0])
                if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                    return False
        except Exception:
            return False  # Cannot resolve → reject
        return True
    except Exception:
        return False


def _meta_value(html: str, *names: str) -> Optional[str]:
    """Extract content from <meta property=... content=...> for any of names."""
    for name in names:
        # property="og:title" content="..." or content="..." property="..."
        for pattern in (
            rf'<meta[^>]+(?:property|name)=["\']({re.escape(name)})["\'][^>]*content=["\']([^"\']+)["\']',
            rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']({re.escape(name)})["\']',
        ):
            m = re.search(pattern, html, re.IGNORECASE)
            if m:
                # The content group depends on which pattern matched
                groups = m.groups()
                # Find the one that's not the name itself
                return next((g for g in groups if g != name), None)
    return None


def _extract_title(html: str) -> Optional[str]:
    m = re.search(r"<title[^>]*>([^<]+)</title>", html, re.IGNORECASE)
    return m.group(1).strip() if m else None


@router.get("/preview", response_model=LinkPreview)
async def link_preview(url: str = Query(..., min_length=1, max_length=2000)):
    """
    Fetch a URL and return Open Graph metadata for rendering a preview card.
    """
    if not await _looks_safe(url):
        raise HTTPException(400, "URL not allowed")

    import time
    now = time.time()

    # Check local cache first
    cached = _local_cache.get(url)
    if cached and cached[0] > now:
        return cached[1]

    # Try Redis if available
    redis_client = None
    try:
        import redis.asyncio as aredis
        redis_client = aredis.from_url(settings.REDIS_URL or "redis://127.0.0.1:6379")
        cached_json = await redis_client.get(f"preview:{url}")
        if cached_json:
            import json
            return LinkPreview(**json.loads(cached_json))
    except Exception:
        redis_client = None

    # Fetch the URL
    try:
        async with httpx.AsyncClient(
            timeout=8.0,
            follow_redirects=True,
            headers={"User-Agent": "ConjiwebBot/1.0 (link preview)"},
            limits=httpx.Limits(max_connections=5),
        ) as client:
            resp = await client.get(url)
            if resp.status_code >= 400:
                raise HTTPException(502, f"Target returned {resp.status_code}")
            ctype = resp.headers.get("content-type", "").lower()
            if "html" not in ctype and "xml" not in ctype:
                # Probably an image/video - return minimal preview
                preview = LinkPreview(url=url, image=url if "image" in ctype else None)
            else:
                # Parse HTML
                html = resp.text[:200_000]  # cap at 200KB
                preview = LinkPreview(
                    url=url,
                    title=_meta_value(html, "og:title") or _extract_title(html),
                    description=_meta_value(html, "og:description", "description"),
                    image=_meta_value(html, "og:image", "twitter:image"),
                    site_name=_meta_value(html, "og:site_name"),
                )
                # Resolve relative image URLs
                if preview.image and not preview.image.startswith(("http://", "https://")):
                    parsed = urlparse(url)
                    if preview.image.startswith("//"):
                        preview.image = f"{parsed.scheme}:{preview.image}"
                    elif preview.image.startswith("/"):
                        preview.image = f"{parsed.scheme}://{parsed.netloc}{preview.image}"
                    else:
                        preview.image = f"{parsed.scheme}://{parsed.netloc}/{preview.image}"
                # Favicon
                preview.favicon = f"{urlparse(url).scheme}://{urlparse(url).netloc}/favicon.ico"
    except httpx.TimeoutException:
        raise HTTPException(504, "Target timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Fetch failed: {e}")

    # Store in caches
    _local_cache_set(url, now + _CACHE_TTL, preview)
    if redis_client:
        try:
            import json
            await redis_client.setex(
                f"preview:{url}",
                _CACHE_TTL,
                json.dumps(preview.model_dump()),
            )
            await redis_client.close()
        except Exception:
            pass

    return preview
