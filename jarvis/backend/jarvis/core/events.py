"""Real-time event bus.

Every user-visible state change (status line, streamed text, tool start/finish,
approval requests, notifications) is published on the user's channel. The web
socket, the voice pipeline and the messenger dispatcher are all just
subscribers — which is what makes Web / Telegram / WhatsApp / Voice different
views of one JARVIS rather than separate bots.

Events carry *safe* status only; model reasoning is never published.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import uuid
from collections import defaultdict
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any

from redis.asyncio import Redis


def _default(o: Any) -> Any:
    if isinstance(o, uuid.UUID):
        return str(o)
    if isinstance(o, datetime):
        return o.isoformat()
    raise TypeError(f"not JSON serializable: {type(o)}")


def make_event(type_: str, **data: Any) -> dict[str, Any]:
    return {"type": type_, "ts": datetime.now(timezone.utc).isoformat(), **data}


class EventBus:
    async def publish(self, user_id: uuid.UUID | str, event: dict[str, Any]) -> None:  # pragma: no cover
        raise NotImplementedError

    def subscribe(self, user_id: uuid.UUID | str) -> AsyncIterator[dict[str, Any]]:  # pragma: no cover
        raise NotImplementedError

    async def close(self) -> None:
        return None


class RedisEventBus(EventBus):
    def __init__(self, redis: Redis):
        self.redis = redis

    @staticmethod
    def _chan(user_id: uuid.UUID | str) -> str:
        return f"jarvis:events:{user_id}"

    async def publish(self, user_id: uuid.UUID | str, event: dict[str, Any]) -> None:
        await self.redis.publish(self._chan(user_id), json.dumps(event, default=_default))

    async def subscribe(self, user_id: uuid.UUID | str) -> AsyncIterator[dict[str, Any]]:
        pubsub = self.redis.pubsub(ignore_subscribe_messages=True)
        await pubsub.subscribe(self._chan(user_id))
        try:
            while True:
                msg = await pubsub.get_message(timeout=30.0)
                if msg is None:
                    continue
                try:
                    yield json.loads(msg["data"])
                except (ValueError, TypeError):
                    continue
        finally:
            with contextlib.suppress(Exception):
                await pubsub.unsubscribe()
                await pubsub.aclose()


class MemoryEventBus(EventBus):
    """In-process bus for tests and the single-process dev mode."""

    def __init__(self) -> None:
        self._subs: dict[str, set[asyncio.Queue]] = defaultdict(set)
        self.history: list[tuple[str, dict[str, Any]]] = []

    async def publish(self, user_id: uuid.UUID | str, event: dict[str, Any]) -> None:
        event = json.loads(json.dumps(event, default=_default))
        self.history.append((str(user_id), event))
        for q in list(self._subs[str(user_id)]):
            q.put_nowait(event)

    async def subscribe(self, user_id: uuid.UUID | str) -> AsyncIterator[dict[str, Any]]:
        q: asyncio.Queue = asyncio.Queue()
        self._subs[str(user_id)].add(q)
        try:
            while True:
                yield await q.get()
        finally:
            self._subs[str(user_id)].discard(q)
