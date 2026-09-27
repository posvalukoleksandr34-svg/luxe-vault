"""Relational schema.

One PostgreSQL database holds everything durable: relational data, the task
queue (SELECT … FOR UPDATE SKIP LOCKED), full-text indexes and vectors
(pgvector). Redis only carries ephemeral traffic (live events, rate limits,
worker wake-ups) — losing it loses nothing that matters.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
    Boolean,
    Computed,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR, UUID
from sqlalchemy.orm import Mapped, mapped_column

from jarvis.db.base import Base, TimestampMixin, new_id, utcnow

JSON = JSONB


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=new_id)


def _fk(target: str, *, nullable: bool = False, ondelete: str = "CASCADE") -> Mapped[Any]:
    return mapped_column(UUID(as_uuid=True), ForeignKey(target, ondelete=ondelete), nullable=nullable, index=True)


# ---------------------------------------------------------------------------------------------------
# identity & access
# ---------------------------------------------------------------------------------------------------


class User(TimestampMixin, Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = _uuid_pk()
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False, default="Owner")
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    totp_secret_enc: Mapped[str | None] = mapped_column(Text)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_owner: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC", nullable=False)
    locale: Mapped[str] = mapped_column(String(16), default="ru", nullable=False)
    # Free-form preferences: notification channels, voice, quiet hours...
    settings: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuthSession(Base):
    """A signed-in browser, or a device token (voice satellite, CLI)."""

    __tablename__ = "auth_sessions"
    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id")
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="browser")  # browser | device
    name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    scopes: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    user_agent: Mapped[str | None] = mapped_column(Text)
    ip: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Set when the user re-authenticated recently (password/TOTP) — gates RESTRICTED approvals.
    elevated_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ChannelLink(TimestampMixin, Base):
    """Maps an external identity (Telegram chat, WhatsApp number) to a JARVIS user."""

    __tablename__ = "channel_links"
    __table_args__ = (UniqueConstraint("channel", "external_id", name="uq_channel_links_channel_external"),)
    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id")
    channel: Mapped[str] = mapped_column(String(32), nullable=False)
    external_id: Mapped[str] = mapped_column(String(128), nullable=False)
    display: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    meta: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)


class PairingCode(Base):
    """Short-lived one-time code used to link a messenger account from the UI."""

    __tablename__ = "pairing_codes"
    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id")
    channel: Mapped[str] = mapped_column(String(32), nullable=False)
    code_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# ---------------------------------------------------------------------------------------------------
# conversations
# ---------------------------------------------------------------------------------------------------


class Conversation(TimestampMixin, Base):
    __tablename__ = "conversations"
    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id")
    title: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    # The continuous "life thread" that messengers and voice write into.
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Episodic summary of turns that fell out of the short-term window.
    summary: Mapped[str] = mapped_column(Text, default="", nullable=False)
    summarized_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    state: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (Index("ix_messages_conversation_created", "conversation_id", "created_at"),)
    id: Mapped[uuid.UUID] = _uuid_pk()
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)  # user | assistant | notice
    content: Mapped[str] = mapped_column(Text, default="", nullable=False)
    # Compact trace of tools used to produce an assistant message (replayed as context).
    tool_trace: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    attachments: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    channel: Mapped[str] = mapped_column(String(32), default="web", nullable=False)
    task_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True)
    meta: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


# ---------------------------------------------------------------------------------------------------
# task engine
# ---------------------------------------------------------------------------------------------------


class Task(TimestampMixin, Base):
    """Durable unit of work. The worker claims rows with SKIP LOCKED and checkpoints `state`."""

    __tablename__ = "tasks"
    __table_args__ = (
        Index("ix_tasks_claim", "status", "run_after", "priority"),
        Index("ix_tasks_user_created", "user_id", "created_at"),
    )
    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id")
    conversation_id: Mapped[uuid.UUID | None] = _fk("conversations.id", nullable=True, ondelete="SET NULL")
    parent_id: Mapped[uuid.UUID | None] = _fk("tasks.id", nullable=True, ondelete="SET NULL")
    kind: Mapped[str] = mapped_column(String(32), nullable=False)  # agent_turn | background | subagent | ...
    status: Mapped[str] = mapped_column(String(24), default="queued", nullable=False)
    title: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    channel: Mapped[str] = mapped_column(String(32), default="web", nullable=False)
    input: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    state: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    result: Mapped[dict | None] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(Text)
    priority: Mapped[int] = mapped_column(Integer, default=100, nullable=False)  # lower = sooner
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    run_after: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    lease_owner: Mapped[str | None] = mapped_column(String(128))
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    trace_id: Mapped[str] = mapped_column(String(32), nullable=False, default=lambda: uuid.uuid4().hex)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class TaskEvent(Base):
    """Persisted, user-safe status events (never chain-of-thought)."""

    __tablename__ = "task_events"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    task_id: Mapped[uuid.UUID] = _fk("tasks.id")
    type: Mapped[str] = mapped_column(String(48), nullable=False)
    data: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class ToolCall(Base):
    __tablename__ = "tool_calls"
    id: Mapped[uuid.UUID] = _uuid_pk()
    task_id: Mapped[uuid.UUID] = _fk("tasks.id")
    # Model-issued id — the idempotency key: a resumed task never re-runs a completed call.
    tool_use_id: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    tool_name: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    input: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    output: Mapped[Any | None] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(24), default="pending", nullable=False)
    error: Mapped[str | None] = mapped_column(Text)
    risk: Mapped[str] = mapped_column(String(16), default="read", nullable=False)
    tier: Mapped[str] = mapped_column(String(16), default="autonomous", nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Approval(Base):
    __tablename__ = "approvals"
    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id")
    task_id: Mapped[uuid.UUID] = _fk("tasks.id")
    tool_use_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    tool_name: Mapped[str] = mapped_column(String(128), nullable=False)
    arguments: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    summary: Mapped[str] = mapped_column(Text, default="", nullable=False)
    risk: Mapped[str] = mapped_column(String(16), nullable=False)
    tier: Mapped[str] = mapped_column(String(16), nullable=False)  # confirm | restricted
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    channel: Mapped[str] = mapped_column(String(32), default="web", nullable=False)
    decided_via: Mapped[str | None] = mapped_column(String(32))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reason: Mapped[str | None] = mapped_column(Text)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class LLMCall(Base):
    __tablename__ = "llm_calls"
    id: Mapped[uuid.UUID] = _uuid_pk()
    task_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True)
    route: Mapped[str] = mapped_column(String(32), nullable=False)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    model: Mapped[str] = mapped_column(String(96), nullable=False)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    cache_read_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    cache_write_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    stop_reason: Mapped[str | None] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16), default="ok", nullable=False)
    error: Mapped[str | None] = mapped_column(Text)
    request_id: Mapped[str | None] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False, index=True
    )


# ---------------------------------------------------------------------------------------------------
# memory
# ---------------------------------------------------------------------------------------------------

MEMORY_KINDS = ("profile", "semantic", "episodic", "project", "relationship", "important")


class Memory(TimestampMixin, Base):
    __tablename__ = "memories"
    __table_args__ = (
        Index("ix_memories_user_status_kind", "user_id", "status", "kind"),
        Index("ix_memories_tsv", "tsv", postgresql_using="gin"),
        Index("ix_memories_content_trgm", "content", postgresql_using="gin", postgresql_ops={"content": "gin_trgm_ops"}),
    )
    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id")
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # Who/what the memory is about — a person, project, place ("Анна", "JARVIS project").
    subject: Mapped[str | None] = mapped_column(String(200))
    tags: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    importance: Mapped[float] = mapped_column(Float, default=0.5, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, default=0.8, nullable=False)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    source: Mapped[str] = mapped_column(String(24), default="extracted", nullable=False)  # explicit|extracted|user
    source_ref: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16), default="active", nullable=False)  # active|superseded|deleted
    superseded_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    access_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_accessed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    tsv: Mapped[Any] = mapped_column(
        TSVECTOR,
        # Russian + English stemming so "нравится" finds "нравиться", "likes" finds "like".
        Computed(
            "to_tsvector('russian'::regconfig, coalesce(subject, '') || ' ' || content)"
            " || to_tsvector('english'::regconfig, coalesce(subject, '') || ' ' || content)",
            persisted=True,
        ),
    )


class MemoryEmbedding(Base):
    """Vectors live beside, not inside, memories: the embedding model can change and be re-indexed."""

    __tablename__ = "memory_embeddings"
    memory_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("memories.id", ondelete="CASCADE"), primary_key=True
    )
    model: Mapped[str] = mapped_column(String(128), primary_key=True)
    embedding: Mapped[Any] = mapped_column(Vector(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


# ---------------------------------------------------------------------------------------------------
# skills, permissions, integrations, settings
# ---------------------------------------------------------------------------------------------------


class SkillState(TimestampMixin, Base):
    __tablename__ = "skill_states"
    name: Mapped[str] = mapped_column(String(64), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    config: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)


class PermissionRule(TimestampMixin, Base):
    """User overrides on top of config/permissions.yaml. target = tool name, skill:<name> or risk:<level>."""

    __tablename__ = "permission_rules"
    __table_args__ = (UniqueConstraint("user_id", "target", "channel", name="uq_permission_rules_target"),)
    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id")
    target: Mapped[str] = mapped_column(String(160), nullable=False)
    channel: Mapped[str] = mapped_column(String(32), default="*", nullable=False)
    tier: Mapped[str] = mapped_column(String(16), nullable=False)
    note: Mapped[str] = mapped_column(Text, default="", nullable=False)


class Integration(TimestampMixin, Base):
    __tablename__ = "integrations"
    __table_args__ = (UniqueConstraint("user_id", "provider", name="uq_integrations_user_provider"),)
    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id")
    provider: Mapped[str] = mapped_column(String(32), nullable=False)  # google | ...
    status: Mapped[str] = mapped_column(String(16), default="connected", nullable=False)
    account: Mapped[str] = mapped_column(String(320), default="", nullable=False)
    scopes: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    credentials_enc: Mapped[str | None] = mapped_column(Text)  # MultiFernet-encrypted JSON
    meta: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)


class SystemSetting(TimestampMixin, Base):
    """Key/value settings editable from the UI. Secret values are stored encrypted."""

    __tablename__ = "system_settings"
    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value: Mapped[Any | None] = mapped_column(JSON)
    secret_enc: Mapped[str | None] = mapped_column(Text)


class McpServer(TimestampMixin, Base):
    __tablename__ = "mcp_servers"
    id: Mapped[uuid.UUID] = _uuid_pk()
    name: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    transport: Mapped[str] = mapped_column(String(16), nullable=False)  # http | stdio
    url: Mapped[str | None] = mapped_column(Text)
    command: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    headers_enc: Mapped[str | None] = mapped_column(Text)
    default_risk: Mapped[str] = mapped_column(String(16), default="external", nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


# ---------------------------------------------------------------------------------------------------
# automation
# ---------------------------------------------------------------------------------------------------


class Automation(TimestampMixin, Base):
    __tablename__ = "automations"
    __table_args__ = (Index("ix_automations_due", "enabled", "next_run_at"),)
    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id")
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    # reminder: deliver `message` verbatim; agent: run `prompt` through the agent and deliver the result.
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    schedule_type: Mapped[str] = mapped_column(String(16), nullable=False)  # once | cron | interval
    cron: Mapped[str | None] = mapped_column(String(128))
    run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    interval_seconds: Mapped[int | None] = mapped_column(Integer)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC", nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    channels: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_status: Mapped[str | None] = mapped_column(String(24))
    run_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_by: Mapped[str] = mapped_column(String(16), default="agent", nullable=False)
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id")
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    body: Mapped[str] = mapped_column(Text, default="", nullable=False)
    level: Mapped[str] = mapped_column(String(16), default="info", nullable=False)
    source: Mapped[str] = mapped_column(String(64), default="system", nullable=False)
    ref: Mapped[str | None] = mapped_column(String(64))
    delivered: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


# ---------------------------------------------------------------------------------------------------
# built-in personal data stores (used when no external provider is connected)
# ---------------------------------------------------------------------------------------------------


class CalendarEvent(TimestampMixin, Base):
    __tablename__ = "calendar_events"
    __table_args__ = (Index("ix_calendar_events_user_start", "user_id", "start_at"),)
    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id")
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    location: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    all_day: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    attendees: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="confirmed", nullable=False)


class EmailDraft(TimestampMixin, Base):
    __tablename__ = "email_drafts"
    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id")
    to: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    cc: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    subject: Mapped[str] = mapped_column(String(998), default="", nullable=False)
    body: Mapped[str] = mapped_column(Text, default="", nullable=False)
    in_reply_to: Mapped[str | None] = mapped_column(String(256))
    status: Mapped[str] = mapped_column(String(16), default="draft", nullable=False)  # draft | sent
    provider: Mapped[str] = mapped_column(String(16), default="local", nullable=False)
    provider_ref: Mapped[str | None] = mapped_column(String(256))


# ---------------------------------------------------------------------------------------------------
# audit
# ---------------------------------------------------------------------------------------------------


class AuditLog(Base):
    """Append-only, hash-chained. A trigger (see migration) rejects UPDATE and DELETE."""

    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True)
    actor: Mapped[str] = mapped_column(String(32), nullable=False)  # user | agent | system | channel:<x>
    action: Mapped[str] = mapped_column(String(96), nullable=False, index=True)
    target: Mapped[str | None] = mapped_column(String(256))
    data: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    trace_id: Mapped[str | None] = mapped_column(String(32))
    prev_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    hash: Mapped[str] = mapped_column(String(64), nullable=False)

