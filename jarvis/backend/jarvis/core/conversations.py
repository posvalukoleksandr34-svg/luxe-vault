"""Conversation service — the single entry point for user input from every channel.

Web, Telegram, WhatsApp and voice all call `submit()`: the message is stored in
the conversation (by default the user's continuous primary thread) and an
`agent_turn` task is queued. One brain, one memory, many doors.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import select

from jarvis.db.base import utcnow
from jarvis.db.models import Conversation, Message, Task

if TYPE_CHECKING:  # pragma: no cover
    from jarvis.core.container import AppContext

STOP_WORDS = {"/stop", "стоп", "stop", "отмена", "/cancel"}


class ConversationService:
    def __init__(self, app: "AppContext"):
        self.app = app

    async def primary(self, user_id: uuid.UUID) -> Conversation:
        async with self.app.sessionmaker() as session:
            conv = (await session.execute(
                select(Conversation).where(Conversation.user_id == user_id, Conversation.is_primary.is_(True))
            )).scalar_one_or_none()
            if conv is None:
                conv = Conversation(user_id=user_id, title="JARVIS", is_primary=True, state={})
                session.add(conv)
                await session.commit()
            return conv

    async def create(self, user_id: uuid.UUID, title: str = "") -> Conversation:
        async with self.app.sessionmaker() as session:
            conv = Conversation(user_id=user_id, title=title[:300], state={})
            session.add(conv)
            await session.commit()
            return conv

    async def get(self, user_id: uuid.UUID, conversation_id: uuid.UUID) -> Conversation | None:
        async with self.app.sessionmaker() as session:
            conv = await session.get(Conversation, conversation_id)
        return conv if conv is not None and conv.user_id == user_id else None

    async def running_turns(self, conversation_id: uuid.UUID) -> list[Task]:
        async with self.app.sessionmaker() as session:
            return list((await session.execute(
                select(Task).where(Task.conversation_id == conversation_id, Task.kind == "agent_turn",
                                   Task.status.in_(["queued", "running", "waiting_approval"]))
            )).scalars())

    async def submit(self, *, user_id: uuid.UUID, text: str, channel: str = "web",
                     conversation_id: uuid.UUID | None = None, attachments: list[dict[str, Any]] | None = None,
                     reply_to: str | None = None, meta: dict[str, Any] | None = None) -> tuple[Message, Task | None]:
        conv = await self.get(user_id, conversation_id) if conversation_id else await self.primary(user_id)
        if conv is None:
            raise LookupError("conversation not found")
        text = (text or "").strip()

        if text.lower() in STOP_WORDS:
            stopped = 0
            for t in await self.running_turns(conv.id):
                stopped += int(await self.app.tasks.cancel(t.id, user_id=user_id))
            note = await self._store(conv, "notice", f"Остановлено задач: {stopped}", channel, meta)
            return note, None

        msg = await self._store(conv, "user", text, channel, meta, attachments)
        task = await self.app.tasks.create(
            user_id=user_id, kind="agent_turn", title=text[:120] or "(attachment)", conversation_id=conv.id,
            channel=channel, priority=10,
            input={"text": text, "message_id": str(msg.id), "attachments": attachments or [], "reply_to": reply_to},
            max_attempts=2,
        )
        async with self.app.sessionmaker() as session:
            row = await session.get(Message, msg.id)
            row.task_id = task.id
            conv_row = await session.get(Conversation, conv.id)
            if not conv_row.title or conv_row.title == "New chat":
                conv_row.title = text[:80]
            conv_row.updated_at = utcnow()
            await session.commit()
        msg.task_id = task.id
        return msg, task

    async def _store(self, conv: Conversation, role: str, text: str, channel: str, meta: dict | None,
                     attachments: list | None = None) -> Message:
        from jarvis.agent.harness import serialize_message
        from jarvis.core.events import make_event

        async with self.app.sessionmaker() as session:
            msg = Message(conversation_id=conv.id, role=role, content=text, channel=channel,
                          attachments=attachments or [], meta=meta or {})
            session.add(msg)
            await session.commit()
        await self.app.bus.publish(conv.user_id, make_event("message.created", conversation_id=str(conv.id),
                                                            data={"message": serialize_message(msg)}))
        return msg
