"""Automation engine: reminders, recurring agent jobs, periodic maintenance.

    automations table ──(tick every 10 s, SKIP LOCKED)──► automation_run task ──► worker
        reminder: deliver the text verbatim to the user's channels (no LLM, cannot fail on the model)
        agent:    run the stored prompt through JARVIS and deliver the result

Several workers can tick concurrently: each due row is locked by exactly one of
them. `next_run_at` is advanced in the same transaction, so a crash can at
worst delay a run, never duplicate it.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any

from sqlalchemy import String, cast, select

from jarvis.core.logging import log
from jarvis.core.timeparse import next_cron, to_local
from jarvis.db.base import utcnow
from jarvis.db.models import Automation, Task, TaskEvent
from jarvis.tools.base import ToolError

if TYPE_CHECKING:  # pragma: no cover
    from jarvis.core.container import AppContext


def compute_next(a: Automation, *, after: datetime | None = None) -> datetime | None:
    after = after or utcnow()
    if a.schedule_type == "once":
        return a.run_at if (a.run_at and (a.run_count or 0) == 0) else None
    if a.schedule_type == "cron" and a.cron:
        return next_cron(a.cron, a.timezone, after)
    if a.schedule_type == "interval" and a.interval_seconds:
        base = a.last_run_at or a.created_at or after
        nxt = base + timedelta(seconds=a.interval_seconds)
        return nxt if nxt > after else after + timedelta(seconds=a.interval_seconds)
    return None


def serialize_automation(a: Automation) -> dict[str, Any]:
    return {
        "id": str(a.id), "name": a.name, "kind": a.kind, "schedule_type": a.schedule_type, "cron": a.cron,
        "run_at": a.run_at.isoformat() if a.run_at else None, "interval_seconds": a.interval_seconds,
        "timezone": a.timezone, "payload": a.payload, "channels": a.channels, "enabled": a.enabled,
        "next_run_at": a.next_run_at.isoformat() if a.next_run_at else None,
        "next_run_local": to_local(a.next_run_at, a.timezone) if a.next_run_at else None,
        "last_run_at": a.last_run_at.isoformat() if a.last_run_at else None, "last_status": a.last_status,
        "run_count": a.run_count, "created_by": a.created_by,
    }


class AutomationService:
    def __init__(self, app: "AppContext"):
        self.app = app

    async def create(self, *, user_id: uuid.UUID, name: str, kind: str, schedule_type: str, timezone_name: str,
                     payload: dict[str, Any], cron: str | None = None, run_at: datetime | None = None,
                     interval_seconds: int | None = None, channels: list[str] | None = None,
                     created_by: str = "agent", conversation_id: uuid.UUID | None = None) -> Automation:
        if kind not in ("reminder", "agent"):
            raise ToolError("kind must be reminder or agent")
        if schedule_type == "interval" and (interval_seconds or 0) < 300:
            raise ToolError("interval must be at least 5 minutes")
        if self.app.billing is not None:
            await self.app.billing.require(user_id, "automations")
            await self.app.billing.check(user_id, "automations")
        a = Automation(user_id=user_id, name=name[:300], kind=kind, schedule_type=schedule_type, cron=cron,
                       run_at=run_at, interval_seconds=interval_seconds, timezone=timezone_name, payload=payload,
                       channels=channels or [], created_by=created_by, conversation_id=conversation_id,
                       created_at=utcnow())
        a.next_run_at = compute_next(a)
        if a.next_run_at is None:
            raise ToolError("could not compute the next run time from that schedule")
        async with self.app.sessionmaker() as session:
            session.add(a)
            await session.commit()
        return a

    async def list(self, user_id: uuid.UUID, *, kind: str | None = None, include_disabled: bool = False) -> list[Automation]:
        async with self.app.sessionmaker() as session:
            stmt = select(Automation).where(Automation.user_id == user_id)
            if kind:
                stmt = stmt.where(Automation.kind == kind)
            if not include_disabled:
                stmt = stmt.where(Automation.enabled.is_(True))
            return list((await session.execute(stmt.order_by(Automation.next_run_at.asc().nulls_last()))).scalars())

    async def get(self, user_id: uuid.UUID, ref: str) -> Automation:
        async with self.app.sessionmaker() as session:
            rows = list((await session.execute(
                select(Automation).where(Automation.user_id == user_id,
                                         cast(Automation.id, String).like(f"{ref.strip()}%"))
                .limit(2))).scalars())
        if len(rows) != 1:
            raise ToolError("automation not found" if not rows else "ambiguous id — use more characters")
        return rows[0]

    async def set_enabled(self, user_id: uuid.UUID, ref: str, enabled: bool) -> Automation:
        a = await self.get(user_id, ref)
        async with self.app.sessionmaker() as session:
            row = await session.get(Automation, a.id)
            row.enabled = enabled
            row.next_run_at = compute_next(row) if enabled else row.next_run_at
            await session.commit()
            return row

    async def delete(self, user_id: uuid.UUID, ref: str) -> Automation:
        a = await self.get(user_id, ref)
        async with self.app.sessionmaker() as session:
            row = await session.get(Automation, a.id)
            await session.delete(row)
            await session.commit()
        return a

    # ------------------------------------------------------------------ scheduler tick

    async def tick(self) -> int:
        """Enqueue every due automation. Safe to run from several workers at once."""
        fired = 0
        now = utcnow()
        async with self.app.sessionmaker() as session:
            due = list((await session.execute(
                select(Automation)
                .where(Automation.enabled.is_(True), Automation.next_run_at.is_not(None), Automation.next_run_at <= now)
                .order_by(Automation.next_run_at).limit(50).with_for_update(skip_locked=True)
            )).scalars())
            for a in due:
                late = (now - a.next_run_at).total_seconds()
                task = Task(user_id=a.user_id, kind="automation_run", title=a.name, channel="automation",
                            conversation_id=a.conversation_id, priority=50 if a.kind == "reminder" else 120,
                            input={"automation_id": str(a.id), "kind": a.kind, "payload": a.payload,
                                   "channels": a.channels, "scheduled_for": a.next_run_at.isoformat(),
                                   "late_seconds": int(late)},
                            state={}, max_attempts=3)
                session.add(task)
                a.last_run_at = now
                a.run_count += 1
                a.last_status = "queued"
                a.next_run_at = compute_next(a, after=now)
                if a.next_run_at is None:
                    a.enabled = False
                fired += 1
            await session.commit()
        if fired:
            await self.app.tasks.wake()
            log.info("scheduler.fired", count=fired)
        return fired


class Maintenance:
    """Periodic housekeeping run by the scheduler loop."""

    def __init__(self, app: "AppContext"):
        self.app = app
        self._last: dict[str, float] = {}

    def _due(self, name: str, every_s: int) -> bool:
        loop = asyncio.get_running_loop()
        now = loop.time()
        if now - self._last.get(name, -1e9) >= every_s:
            self._last[name] = now
            return True
        return False

    async def run(self) -> None:
        if self._due("approvals", 60):
            await self.app.approvals.expire_stale()
        if self._due("memories", 3600):
            await self.app.memory.expire_old()
        if self._due("events", 6 * 3600):
            async with self.app.sessionmaker() as session:
                cutoff = datetime.now(timezone.utc) - timedelta(days=30)
                await session.execute(TaskEvent.__table__.delete().where(TaskEvent.created_at < cutoff))
                await session.commit()
        if self._due("queue_depth", 30):
            from jarvis.core.metrics import TASK_QUEUE

            TASK_QUEUE.set(await self.app.tasks.queue_depth())


async def scheduler_loop(app: "AppContext", stop: asyncio.Event, *, interval_s: float = 10.0) -> None:
    maintenance = Maintenance(app)
    log.info("scheduler.started")
    while not stop.is_set():
        try:
            await app.automations.tick()
            await maintenance.run()
        except Exception:  # noqa: BLE001 - the scheduler must survive transient DB errors
            log.exception("scheduler.tick_failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval_s)
        except asyncio.TimeoutError:
            pass
