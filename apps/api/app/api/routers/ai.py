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



# =====================================================
# KILLER-01: @ai mention assistant for group chats
# =====================================================
class AssistantRequest(BaseModel):
    """Request to the AI assistant when @ai is mentioned in a chat."""
    prompt: str
    context_messages: List[str] = []   # last N messages for context
    conversation_id: Optional[str] = None
    persona: Optional[str] = None       # "helpful" / "concise" / "translator"


class AssistantResponse(BaseModel):
    reply: str


@router.post("/assistant", response_model=AssistantResponse)
async def ai_assistant(req: AssistantRequest):
    """
    Group-chat AI assistant. Triggered when a user types @ai in a message.

    The bridge layer detects "@ai" prefix, sends the prompt + recent context
    to this endpoint, and posts the reply back into the conversation.

    The assistant is persona-aware so admins can configure team-specific
    behavior (e.g. always reply in English, always cite sources, etc.).
    """
    api_key, base_url, model = _provider_config()

    persona_prompts = {
        "helpful": "You are a helpful assistant in a group chat. Reply concisely.",
        "concise": "You are a concise assistant. Reply in 1-2 sentences max.",
        "translator": "You are a translator. Detect the language of the prompt and translate to English, or to the language of the rest of the chat if it differs.",
    }
    system = persona_prompts.get(req.persona or "helpful", persona_prompts["helpful"])

    messages = [{"role": "system", "content": system}]
    if req.context_messages:
        messages.append({
            "role": "system",
            "content": "Recent conversation context:\n" + "\n".join(req.context_messages[-10:]),
        })
    messages.append({"role": "user", "content": req.prompt})

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{base_url}/chat/completions",
                json={"model": model, "messages": messages, "max_tokens": 500},
                headers={"Authorization": f"Bearer {api_key}"},
            )
            resp.raise_for_status()
            data = resp.json()
            reply = data["choices"][0]["message"]["content"].strip()
            return AssistantResponse(reply=reply)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"AI provider error: {e}")


# =====================================================
# KILLER-01: Conversation insights (sentiment, response time)
# =====================================================
class InsightRequest(BaseModel):
    messages: List[str]


class InsightResponse(BaseModel):
    sentiment: str       # "positive" / "neutral" / "negative" / "urgent"
    summary: str
    suggested_action: Optional[str] = None


@router.post("/insight", response_model=InsightResponse)
async def conversation_insight(req: InsightRequest):
    """
    Quick conversation insight - sentiment + suggested action.
    Used in the right-panel "smart suggestions" area.
    """
    if not req.messages:
        return InsightResponse(sentiment="neutral", summary="")

    api_key, base_url, model = _provider_config()
    convo = "\n".join(req.messages[-20:])
    prompt = (
        "Analyze this conversation snippet. Reply ONLY with JSON like:\n"
        '{"sentiment": "positive|neutral|negative|urgent", "summary": "<one sentence>", "suggested_action": "<optional next step>"}\n\n'
        f"Conversation:\n{convo}"
    )
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{base_url}/chat/completions",
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 200,
                    "response_format": {"type": "json_object"},
                },
                headers={"Authorization": f"Bearer {api_key}"},
            )
            resp.raise_for_status()
            data = resp.json()
            import json
            parsed = json.loads(data["choices"][0]["message"]["content"])
            return InsightResponse(
                sentiment=parsed.get("sentiment", "neutral"),
                summary=parsed.get("summary", ""),
                suggested_action=parsed.get("suggested_action"),
            )
    except Exception:
        return InsightResponse(sentiment="neutral", summary="")
