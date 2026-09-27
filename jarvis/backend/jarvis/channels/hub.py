"""Channel hub — delivers replies, approval requests and notifications to wherever the user is.

Web and voice are live subscribers of the event bus; messengers are push adapters.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import select

from jarvis.core.events import make_event
from jarvis.core.logging import log
from jarvis.db.models import Approval, ChannelLink, Message, Notification, Task, User

if TYPE_CHECKING:  # pragma: no cover
    from jarvis.core.container import AppContext


class ChannelAdapter:
    name = "base"

    def __init__(self, app: "AppContext"):
        self.app = app

    async def available(self) -> bool:  # pragma: no cover - interface
        return False

    async def send_text(self, external_id: str, text: str) -> None:  # pragma: no cover
        raise NotImplementedError

    async def send_approval(self, external_id: str, approval: Approval, *, web_only: bool) -> None:  # pragma: no cover
        raise NotImplementedError


class ChannelHub:
    def __init__(self, app: "AppContext"):
        self.app = app
        self.adapters: dict[str, ChannelAdapter] = {}

    def register(self, adapter: ChannelAdapter) -> None:
        self.adapters[adapter.name] = adapter

    async def links(self, user_id: uuid.UUID, channel: str | None = None) -> list[ChannelLink]:
        async with self.app.sessionmaker() as session:
            stmt = select(ChannelLink).where(ChannelLink.user_id == user_id, ChannelLink.verified_at.is_not(None))
            if channel:
                stmt = stmt.where(ChannelLink.channel == channel)
            return list((await session.execute(stmt)).scalars())

    async def _send(self, channel: str, external_id: str, text: str) -> bool:
        adapter = self.adapters.get(channel)
        if adapter is None or not await adapter.available():
            return False
        try:
            await adapter.send_text(external_id, text)
            return True
        except Exception:  # noqa: BLE001 - delivery failures are logged, never crash the agent
            log.exception("channel.send_failed", channel=channel)
            return False

    async def deliver_reply(self, task: Task, message: Message) -> None:
        reply_to = (task.input or {}).get("reply_to")
        if task.channel in self.adapters and reply_to:
            await self._send(task.channel, str(reply_to), message.content)

    async def deliver_approval(self, task: Task, approval: Approval) -> None:
        reply_to = (task.input or {}).get("reply_to")
        channel = task.channel
        targets: list[tuple[str, str]] = []
        if channel in self.adapters and reply_to:
            targets.append((channel, str(reply_to)))
        elif channel in ("automation", "web"):
            # background / scheduled work: ask on the user's messengers as well
            for link in await self.links(task.user_id):
                if link.channel in self.adapters:
                    targets.append((link.channel, link.external_id))
        for ch, ext in targets:
            adapter = self.adapters[ch]
            if not await adapter.available():
                continue
            web_only = not self.app.policy.channel_can_approve(ch, _tier(approval.tier))
            try:
                await adapter.send_approval(ext, approval, web_only=web_only)
            except Exception:  # noqa: BLE001
                log.exception("channel.approval_failed", channel=ch)

    async def notify(self, user_id: uuid.UUID, title: str, body: str = "", *, channels: list[str] | None = None,
                     level: str = "info", source: str = "system", ref: str | None = None) -> Notification:
        async with self.app.sessionmaker() as session:
            user = await session.get(User, user_id)
            prefs = (user.settings or {}).get("notify_channels") if user else None
        wanted = channels or prefs or ["web", *self.adapters.keys()]
        delivered: list[str] = ["web"] if "web" in wanted else []
        text = f"{title}\n{body}".strip() if body else title
        for link in await self.links(user_id):
            if link.channel in wanted and link.channel in self.adapters:
                if await self._send(link.channel, link.external_id, text):
                    delivered.append(link.channel)
        async with self.app.sessionmaker() as session:
            note = Notification(user_id=user_id, title=title[:300], body=body, level=level, source=source, ref=ref,
                                delivered=delivered)
            session.add(note)
            await session.commit()
        await self.app.bus.publish(user_id, make_event("notification", data={
            "id": str(note.id), "title": note.title, "body": note.body, "level": level, "source": source}))
        return note


def _tier(value: str):
    from jarvis.tools.base import Tier

    return Tier(value)


def approval_text(approval: Approval, *, web_only: bool, public_url: str) -> str:
    lines = [f"🔐 Я готов выполнить действие:\n{approval.summary}"]
    if web_only:
        lines.append(f"\nЭто действие уровня «{approval.tier}» — подтвердите его в веб-интерфейсе: {public_url}/tasks")
    else:
        lines.append("\nПодтвердить?")
    return "\n".join(lines)


def split_text(text: str, limit: int) -> list[str]:
    parts: list[str] = []
    while len(text) > limit:
        cut = text.rfind("\n", 0, limit)
        cut = cut if cut > limit // 2 else limit
        parts.append(text[:cut])
        text = text[cut:].lstrip("\n")
    if text:
        parts.append(text)
    return parts


def link_payload(link: ChannelLink) -> dict[str, Any]:
    return {"id": str(link.id), "channel": link.channel, "external_id": link.external_id, "display": link.display,
            "verified_at": link.verified_at.isoformat() if link.verified_at else None}
