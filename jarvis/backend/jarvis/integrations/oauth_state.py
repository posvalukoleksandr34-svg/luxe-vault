"""HMAC-signed, expiring OAuth `state` values bound to a user (shared by every OAuth integration)."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import TYPE_CHECKING, Any

from jarvis.tools.base import ToolError

if TYPE_CHECKING:  # pragma: no cover
    from jarvis.core.container import AppContext


def _key(app: "AppContext") -> bytes:
    return hashlib.sha256(app.box.keys[0].encode()).digest()


def sign_state(app: "AppContext", payload: dict[str, Any]) -> str:
    raw = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")
    sig = hmac.new(_key(app), raw.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{raw}.{sig}"


def verify_state(app: "AppContext", state: str) -> dict[str, Any]:
    try:
        raw, sig = state.rsplit(".", 1)
    except ValueError as exc:
        raise ToolError("invalid OAuth state") from exc
    if not hmac.compare_digest(hmac.new(_key(app), raw.encode(), hashlib.sha256).hexdigest()[:32], sig):
        raise ToolError("invalid OAuth state signature")
    payload = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
    if payload.get("exp", 0) < time.time():
        raise ToolError("OAuth state expired — start again")
    return payload
