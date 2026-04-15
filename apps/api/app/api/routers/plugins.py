from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
from app.core.database import get_db
from app.models import Plugin, PluginSetting
import uuid

router = APIRouter()

BUILTIN_PLUGINS = [
    {"id": "ai-summary",   "name": "AI Summary",    "version": "1.0.0", "permissions": ["messages.read", "api.ai"]},
    {"id": "translate",    "name": "Translate",      "version": "1.0.0", "permissions": ["messages.read", "api.ai"]},
    {"id": "quick-reply",  "name": "Quick Reply",    "version": "1.0.0", "permissions": ["messages.send"]},
    {"id": "bot-bridge",   "name": "Bot Bridge",     "version": "1.0.0", "permissions": ["messages.read", "messages.send"]},
    {"id": "reminder",     "name": "Reminder",       "version": "1.0.0", "permissions": ["messages.read"]},
    {"id": "markdown-plus","name": "Markdown Plus",  "version": "1.0.0", "permissions": ["messages.read"]},
]


async def ensure_plugins(db: AsyncSession):
    for p in BUILTIN_PLUGINS:
        result = await db.execute(select(Plugin).where(Plugin.id == p["id"]))
        if not result.scalar_one_or_none():
            db.add(Plugin(id=p["id"], name=p["name"], version=p["version"],
                          is_enabled=False, permission_json=p["permissions"]))
    await db.commit()


@router.get("/")
async def list_plugins(db: AsyncSession = Depends(get_db)):
    await ensure_plugins(db)
    result = await db.execute(select(Plugin))
    return [{"id": p.id, "name": p.name, "version": p.version,
             "is_enabled": p.is_enabled, "permissions": p.permission_json}
            for p in result.scalars().all()]


@router.post("/{plugin_id}/enable")
async def enable_plugin(plugin_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Plugin).where(Plugin.id == plugin_id))
    plugin = result.scalar_one_or_none()
    if not plugin:
        raise HTTPException(404, "Plugin not found")
    plugin.is_enabled = True
    await db.commit()
    return {"ok": True, "plugin_id": plugin_id, "is_enabled": True}


@router.post("/{plugin_id}/disable")
async def disable_plugin(plugin_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Plugin).where(Plugin.id == plugin_id))
    plugin = result.scalar_one_or_none()
    if not plugin:
        raise HTTPException(404, "Plugin not found")
    plugin.is_enabled = False
    await db.commit()
    return {"ok": True, "plugin_id": plugin_id, "is_enabled": False}


@router.get("/{plugin_id}/settings")
async def get_plugin_settings(plugin_id: str, account_id: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    stmt = select(PluginSetting).where(PluginSetting.plugin_id == plugin_id)
    if account_id:
        stmt = stmt.where(PluginSetting.account_id == account_id)
    result = await db.execute(stmt)
    setting = result.scalar_one_or_none()
    return {"config": setting.config_json if setting else {}}


@router.put("/{plugin_id}/settings")
async def update_plugin_settings(plugin_id: str, config: dict, account_id: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    stmt = select(PluginSetting).where(PluginSetting.plugin_id == plugin_id)
    if account_id:
        stmt = stmt.where(PluginSetting.account_id == account_id)
    result = await db.execute(stmt)
    setting = result.scalar_one_or_none()
    if setting:
        setting.config_json = config
    else:
        db.add(PluginSetting(id=str(uuid.uuid4()), plugin_id=plugin_id, account_id=account_id, config_json=config))
    await db.commit()
    return {"ok": True}
