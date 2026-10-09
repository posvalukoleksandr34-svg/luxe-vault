"""Tamper-evident audit trail.

Each row stores sha256(prev_hash + canonical(row)). Rewriting history breaks the
chain, which `verify_chain` detects; a DB trigger additionally rejects UPDATE
and DELETE. An advisory lock serialises writers so the chain stays linear.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from jarvis.db.base import utcnow
from jarvis.db.models import AuditLog

GENESIS = "0" * 64
_LOCK_KEY = 0x4A415256  # "JARV"


def _canonical(ts: datetime, user_id: Any, actor: str, action: str, target: Any, data: dict) -> str:
    return json.dumps(
        {
            "ts": ts.isoformat(),
            "user_id": str(user_id) if user_id else None,
            "actor": actor,
            "action": action,
            "target": target,
            "data": data,
        },
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )


def _sanitize(data: dict[str, Any]) -> dict[str, Any]:
    secret_words = ("password", "token", "secret", "api_key", "authorization", "code")
    out: dict[str, Any] = {}
    for k, v in data.items():
        if any(w in k.lower() for w in secret_words):
            out[k] = "***"
        elif isinstance(v, str) and len(v) > 2000:
            out[k] = v[:2000] + "…"
        elif isinstance(v, dict):
            out[k] = _sanitize(v)
        else:
            out[k] = v
    return json.loads(json.dumps(out, default=str))


async def audit(
    session: AsyncSession,
    *,
    action: str,
    actor: str,
    user_id: uuid.UUID | None = None,
    target: str | None = None,
    data: dict[str, Any] | None = None,
    trace_id: str | None = None,
) -> AuditLog:
    """Append an entry inside the caller's transaction."""
    await session.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": _LOCK_KEY})
    prev = (await session.execute(select(AuditLog.hash).order_by(AuditLog.id.desc()).limit(1))).scalar()
    prev_hash = prev or GENESIS
    ts = utcnow()
    clean = _sanitize(data or {})
    digest = hashlib.sha256((prev_hash + _canonical(ts, user_id, actor, action, target, clean)).encode()).hexdigest()
    row = AuditLog(
        ts=ts, user_id=user_id, actor=actor, action=action, target=target, data=clean,
        trace_id=trace_id, prev_hash=prev_hash, hash=digest,
    )
    session.add(row)
    await session.flush()
    return row


async def verify_chain(session: AsyncSession, limit: int | None = None) -> tuple[bool, int | None]:
    """Return (ok, first_broken_id)."""
    q = select(AuditLog).order_by(AuditLog.id)
    if limit:
        q = q.limit(limit)
    prev = GENESIS
    for row in (await session.execute(q)).scalars():
        expected = hashlib.sha256(
            (prev + _canonical(row.ts, row.user_id, row.actor, row.action, row.target, row.data)).encode()
        ).hexdigest()
        if row.prev_hash != prev or row.hash != expected:
            return False, row.id
        prev = row.hash
    return True, None
