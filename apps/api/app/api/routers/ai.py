from typing import List, Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.config import settings

router = APIRouter()


class SummarizeRequest(BaseModel):
    messages: List[str]
    conversation_id: Optional[str] = None


class SummarizeResponse(BaseModel):
    summary: str
    key_points: List[str]


def _provider_config() -> tuple[str, str, str]:
    api_key = (settings.AI_API_KEY or "").strip()
    if not api_key:
        raise HTTPException(status_code=503, detail="AI provider is not configured (AI_API_KEY is missing)")
    base_url = (settings.AI_BASE_URL or "https://api.openai.com/v1").rstrip("/")
    model = (settings.AI_MODEL or "gpt-4o-mini").strip()
    return api_key, base_url, model


async def _chat_completion(
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0.2,
) -> str:
    api_key, base_url, model = _provider_config()
    payload = {
        "model": model,
        "temperature": temperature,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(f"{base_url}/chat/completions", json=payload, headers=headers)
        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"AI provider error: {response.status_code}")
        data = response.json()
        content = (
            data.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
        if not isinstance(content, str) or not content.strip():
            raise HTTPException(status_code=502, detail="AI provider returned empty content")
        return content.strip()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI request failed: {exc}")


@router.post(
    "/summarize",
    response_model=SummarizeResponse,
    summary="Summarize conversation",
    description="Summarizes conversation messages via configured AI provider.",
)
async def summarize_conversation(data: SummarizeRequest):
    if not data.messages:
        raise HTTPException(status_code=400, detail="messages is required")

    merged = "\n".join(data.messages[-80:])
    content = await _chat_completion(
        system_prompt=(
            "You summarize chat conversations. Return concise plain text with a first line summary and then up to 5 key points."
        ),
        user_prompt=f"Conversation:\n{merged}\n\nFormat:\nSummary: ...\n- point 1\n- point 2",
        temperature=0.2,
    )
    lines = [line.strip() for line in content.splitlines() if line.strip()]
    summary_line = lines[0].removeprefix("Summary:").strip() if lines else content[:160]
    key_points = [line.lstrip("- ").strip() for line in lines[1:] if line.startswith("-")]
    return SummarizeResponse(summary=summary_line, key_points=key_points[:5])


@router.post(
    "/translate",
    summary="Translate text",
    description="Translates a message into the target language via configured AI provider.",
)
async def translate_message(text: str, target_lang: str = "en"):
    if not text.strip():
        raise HTTPException(status_code=400, detail="text is required")
    translated = await _chat_completion(
        system_prompt="You are a translator. Return only the translated text.",
        user_prompt=f"Translate to {target_lang}:\n{text}",
        temperature=0.0,
    )
    return {"original": text, "translated": translated, "lang": target_lang}


@router.post(
    "/smart-reply",
    summary="Generate smart replies",
    description="Generates short reply suggestions via configured AI provider.",
)
async def smart_reply(message: str):
    if not message.strip():
        raise HTTPException(status_code=400, detail="message is required")
    content = await _chat_completion(
        system_prompt=(
            "Generate 3 short chat reply suggestions. Output exactly one suggestion per line."
        ),
        user_prompt=f"Incoming message:\n{message}",
        temperature=0.7,
    )
    suggestions = [line.strip("- ").strip() for line in content.splitlines() if line.strip()]
    return {"suggestions": suggestions[:3]}
