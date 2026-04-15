from sqlalchemy import Column, String, Boolean, Integer, DateTime, Text, JSON, ForeignKey, BigInteger
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base
import uuid


def gen_uuid():
    return str(uuid.uuid4())


class Account(Base):
    __tablename__ = "accounts"
    id = Column(String, primary_key=True, default=gen_uuid)
    jid = Column(String, unique=True, nullable=False, index=True)
    domain = Column(String, nullable=False)
    display_name = Column(String)
    avatar_url = Column(String)
    is_enabled = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    preferences = relationship("AccountPreference", back_populates="account", uselist=False)
    conversations = relationship("Conversation", back_populates="account")


class AccountPreference(Base):
    __tablename__ = "account_preferences"
    id = Column(String, primary_key=True, default=gen_uuid)
    account_id = Column(String, ForeignKey("accounts.id"), unique=True)
    auto_login = Column(Boolean, default=False)
    default_presence = Column(String, default="available")
    theme_override = Column(String)
    notifications_enabled = Column(Boolean, default=True)
    config_json = Column(JSON, default={})

    account = relationship("Account", back_populates="preferences")


class Contact(Base):
    __tablename__ = "contacts"
    id = Column(String, primary_key=True, default=gen_uuid)
    account_id = Column(String, ForeignKey("accounts.id"), nullable=False)
    jid = Column(String, nullable=False, index=True)
    nickname = Column(String)
    avatar_url = Column(String)
    group_name = Column(String)
    tags = Column(JSON, default=[])
    last_presence = Column(String)
    last_seen_at = Column(DateTime(timezone=True))
    is_blocked = Column(Boolean, default=False)


class Conversation(Base):
    __tablename__ = "conversations"
    id = Column(String, primary_key=True, default=gen_uuid)
    account_id = Column(String, ForeignKey("accounts.id"), nullable=False)
    type = Column(String, nullable=False)  # private/group/system
    peer_jid = Column(String, nullable=False, index=True)
    title = Column(String)
    avatar_url = Column(String)
    last_message_id = Column(String)
    last_message_at = Column(DateTime(timezone=True))
    unread_count = Column(Integer, default=0)
    pinned = Column(Boolean, default=False)
    archived = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    account = relationship("Account", back_populates="conversations")
    messages = relationship("Message", back_populates="conversation")


class Message(Base):
    __tablename__ = "messages"
    id = Column(String, primary_key=True, default=gen_uuid)
    conversation_id = Column(String, ForeignKey("conversations.id"), nullable=False, index=True)
    xmpp_stanza_id = Column(String, index=True)
    sender_jid = Column(String, nullable=False)
    receiver_jid = Column(String)
    body = Column(Text)
    body_type = Column(String, default="text")  # text/html/markdown
    direction = Column(String, nullable=False)  # in/out/system
    status = Column(String, default="sent")  # pending/sent/delivered/read/failed
    reply_to_message_id = Column(String)
    metadata_json = Column(JSON, default={})
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    edited_at = Column(DateTime(timezone=True))
    deleted_at = Column(DateTime(timezone=True))

    conversation = relationship("Conversation", back_populates="messages")
    attachments = relationship("Attachment", back_populates="message")


class Attachment(Base):
    __tablename__ = "attachments"
    id = Column(String, primary_key=True, default=gen_uuid)
    message_id = Column(String, ForeignKey("messages.id"))
    object_key = Column(String, nullable=False)
    file_name = Column(String)
    mime_type = Column(String)
    size_bytes = Column(BigInteger)
    width = Column(Integer)
    height = Column(Integer)
    duration_sec = Column(Integer)
    preview_url = Column(String)
    download_url = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    message = relationship("Message", back_populates="attachments")


class Plugin(Base):
    __tablename__ = "plugins"
    id = Column(String, primary_key=True, default=gen_uuid)
    name = Column(String, unique=True, nullable=False)
    version = Column(String)
    entrypoint = Column(String)
    is_enabled = Column(Boolean, default=False)
    permission_json = Column(JSON, default=[])
    config_schema_json = Column(JSON, default={})
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class PluginSetting(Base):
    __tablename__ = "plugin_settings"
    id = Column(String, primary_key=True, default=gen_uuid)
    plugin_id = Column(String, ForeignKey("plugins.id"), nullable=False)
    account_id = Column(String, nullable=True)
    config_json = Column(JSON, default={})
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(String, primary_key=True, default=gen_uuid)
    actor = Column(String)
    action = Column(String, nullable=False)
    target_type = Column(String)
    target_id = Column(String)
    detail_json = Column(JSON, default={})
    created_at = Column(DateTime(timezone=True), server_default=func.now())
