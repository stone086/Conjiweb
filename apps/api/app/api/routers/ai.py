"""
ai.py - AI utility endpoints (summarize, translate, assistant, insight, RAG).
"""
import json
import re
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import AsyncSessionLocal, get_db
from app.models import Conversation, Message
from app.utils.security import bearer_scheme, decode_token

router = APIRouter()


# ---------------------------------------------------------------------------
# Provider config
# ---------------------------------------------------------------------------
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


# ---------------------------------------------------------------------------
# Auth helper for user-scoped endpoints
# ---------------------------------------------------------------------------
def _get_ai_actor(
    credentials: HTTPAuthorizationCredentials = Security(bearer_scheme),
) -> dict:
    """Accept both admin and user tokens; return role + account_id."""
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token(credentials.credentials)
    role = payload.get("role")
    if role == "admin":
        return {"role": "admin", "account_id": payload.get("account_id")}
    if role == "user" and payload.get("account_id"):
        return {"role": "user", "account_id": payload["account_id"]}
    raise HTTPException(status_code=403, detail="AI access denied")


# ---------------------------------------------------------------------------
# Summarize
# ---------------------------------------------------------------------------
class SummarizeRequest(BaseModel):
    messages: List[str]
    conversation_id: Optional[str] = None


class SummarizeResponse(BaseModel):
    summary: str
    key_points: List[str]


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


# ---------------------------------------------------------------------------
# Translate
# ---------------------------------------------------------------------------
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


# ---------------------------------------------------------------------------
# Smart reply
# ---------------------------------------------------------------------------
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


# ---------------------------------------------------------------------------
# @ai mention assistant
# ---------------------------------------------------------------------------
class AssistantRequest(BaseModel):
    """Request to the AI assistant when @ai is mentioned in a chat."""
    prompt: str
    context_messages: List[str] = []
    conversation_id: Optional[str] = None
    persona: Optional[str] = None


class AssistantResponse(BaseModel):
    reply: str


@router.post("/assistant", response_model=AssistantResponse)
async def ai_assistant(req: AssistantRequest):
    """Group-chat AI assistant triggered by @ai mention."""
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


# ---------------------------------------------------------------------------
# Conversation insight (sentiment)
# ---------------------------------------------------------------------------
class InsightRequest(BaseModel):
    messages: List[str]


class InsightResponse(BaseModel):
    sentiment: str
    summary: str
    suggested_action: Optional[str] = None


@router.post("/insight", response_model=InsightResponse)
async def conversation_insight(req: InsightRequest):
    """Quick conversation insight - sentiment + suggested action."""
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
            # No response_format — not all providers support it (#15)
            resp = await client.post(
                f"{base_url}/chat/completions",
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 200,
                },
                headers={"Authorization": f"Bearer {api_key}"},
            )
            resp.raise_for_status()
            data = resp.json()
            raw = data["choices"][0]["message"]["content"].strip()
            # Strip markdown fences if present
            raw = re.sub(r"^```(?:json)?\s*", "", raw)
            raw = re.sub(r"\s*```$", "", raw)
            parsed = json.loads(raw)
            return InsightResponse(
                sentiment=parsed.get("sentiment", "neutral"),
                summary=parsed.get("summary", ""),
                suggested_action=parsed.get("suggested_action"),
            )
    except (json.JSONDecodeError, KeyError, IndexError):
        return InsightResponse(sentiment="neutral", summary="")
    except Exception:
        return InsightResponse(sentiment="neutral", summary="")


# ---------------------------------------------------------------------------
# RAG (Retrieval-Augmented Generation) — user-scoped (#14)
# ---------------------------------------------------------------------------
class RagRequest(BaseModel):
    """Ask a question, AI answers using the caller's own message history."""
    question: str
    max_messages: int = 200
    conversation_ids: List[str] = []


class RagResponse(BaseModel):
    answer: str
    sources: List[dict] = []


@router.post("/rag", response_model=RagResponse)
async def rag_query(
    req: RagRequest,
    actor: dict = Depends(_get_ai_actor),
):
    """
    Retrieval-augmented generation over the caller's own message history.

    - User token: can only query own conversations
    - Admin token: can query any account (must provide account_id in token)
    """
    account_id = actor.get("account_id")
    if not account_id:
        raise HTTPException(400, "account_id required (derived from token)")

    api_key, base_url, model = _provider_config()

    async with AsyncSessionLocal() as db:
        query = (
            select(Message, Conversation)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .where(Conversation.account_id == account_id)
        )

        # Validate that requested conversation_ids belong to this account
        if req.conversation_ids:
            query = query.where(Message.conversation_id.in_(req.conversation_ids))

        query = query.order_by(desc(Message.created_at)).limit(req.max_messages)
        result = await db.execute(query)
        rows = result.all()

    if not rows:
        return RagResponse(answer="No messages in history to answer from.", sources=[])

    rows = list(reversed(rows))
    context_lines: List[str] = []
    source_index: dict[str, dict] = {}
    for i, (msg, conv) in enumerate(rows):
        if not msg.body:
            continue
        ref_id = f"M{i}"
        source_index[ref_id] = {
            "conversation_id": conv.id,
            "message_id": msg.id,
            "snippet": msg.body[:200],
            "timestamp": msg.created_at.isoformat() if msg.created_at else None,
            "sender": msg.sender_jid,
        }
        ts = msg.created_at.strftime("%Y-%m-%d %H:%M") if msg.created_at else "?"
        context_lines.append(f"[{ref_id}] ({msg.sender_jid}, {ts}): {msg.body[:300]}")

    if not context_lines:
        return RagResponse(answer="No text messages to answer from.", sources=[])

    system_prompt = (
        "You are a helpful assistant answering questions about a user's chat history. "
        "Each message is prefixed with [Mxxx] - use these IDs to cite sources. "
        "Format citations as [Mxxx] inline. Be accurate, concise, and cite sources. "
        "If the answer isn't in the messages, say so."
    )
    user_prompt = (
        f"Chat history:\n{chr(10).join(context_lines)}\n\n"
        f"Question: {req.question}\n\n"
        "Answer:"
    )

    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            resp = await client.post(
                f"{base_url}/chat/completions",
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    "max_tokens": 800,
                },
                headers={"Authorization": f"Bearer {api_key}"},
            )
            resp.raise_for_status()
            data = resp.json()
            answer = data["choices"][0]["message"]["content"].strip()
    except httpx.HTTPError as e:
        raise HTTPException(502, f"AI provider error: {e}")

    cited_refs = set(re.findall(r"\[M(\d+)\]", answer))
    sources = [source_index[f"M{ref}"] for ref in cited_refs if f"M{ref}" in source_index]

    return RagResponse(answer=answer, sources=sources)
