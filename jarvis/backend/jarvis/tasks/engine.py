"""Durable task engine on PostgreSQL.

    create ─► queued ─► running ─► succeeded
                 ▲         │  ├──► waiting_approval ──(decision)──► queued
                 │         │  ├──► failed (after max_attempts)
                 └─retry───┘  └──► cancelled

- Claiming uses `FOR UPDATE SKIP LOCKED`, so any number of workers can run.
- A running task holds a lease that the worker heartbeats; if the worker dies,
  the lease expires and another worker picks the task up and resumes it from
  its last checkpoint (`state`). Tool calls are idempotent by tool_use_id, so a
  resumed step never repeats a completed side effect.
- Redis carries only a wake-up signal (instant pickup) — Postgres is the truth.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from redis.asyncio import Redis
from sqlalchemy import and_, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from jarvis.core.events import EventBus, make_event
from jarvis.core.metrics import TASKS
from jarvis.db.base import utcnow
from jarvis.db.models import Task, TaskEvent

WAKE_KEY = "jarvis:tasks:wake"
CANCEL_KEY = "jarvis:tasks:cancel:{}"
TERMINAL = {"succeeded", "failed", "cancelled"}
ACTIVE = {"queued", "running", "waiting_approval"}


class TaskService:
    def __init__(self, sessionmaker: async_sessionmaker[AsyncSession], bus: EventBus, redis: Redis | None, *,
                 lease_seconds: int = 90):
        self.sessionmaker = sessionmaker
        self.bus = bus
        self.redis = redis
        self.lease_seconds = lease_seconds
        self._local_cancel: set[str] = set()

    # ------------------------------------------------------------------ lifecycle

    async def create(
        self,
        *,
        user_id: uuid.UUID,
        kind: str,
        input: dict[str, Any],
        title: str = "",
        conversation_id: uuid.UUID | None = None,
        parent_id: uuid.UUID | None = None,
        channel: str = "web",
        priority: int = 100,
        run_after=None,
        max_attempts: int = 3,
        session: AsyncSession | None = None,
    ) -> Task:
        task = Task(
            user_id=user_id, kind=kind, input=input, title=title[:300], conversation_id=conversation_id,
            parent_id=parent_id, channel=channel, priority=priority, run_after=run_after or utcnow(),
            max_attempts=max_attempts, state={},
        )
        if session is not None:
            session.add(task)
            await session.flush()
        else:
            async with self.sessionmaker() as s:
                s.add(task)
                await s.commit()
        await self._publish_task(task)
        await self.wake()
        return task

    async def wake(self) -> None:
        if self.redis is not None:
            try:
                await self.redis.lpush(WAKE_KEY, "1")
                await self.redis.ltrim(WAKE_KEY, 0, 50)
            except Exception:  # noqa: BLE001 - wake-up is an optimisation; workers also poll
                pass

    async def wait_for_work(self, timeout: float) -> None:
        if self.redis is None:
            import asyncio

            await asyncio.sleep(timeout)
            return
        try:
            await self.redis.blpop([WAKE_KEY], timeout=timeout)
        except Exception:  # noqa: BLE001
            import asyncio

            await asyncio.sleep(timeout)

    async def claim(self, worker_id: str, *, limit: int = 1) -> list[Task]:
        now = utcnow()
        async with self.sessionmaker() as session:
            stmt = (
                select(Task)
                .where(
                    or_(
                        and_(Task.status == "queued", Task.run_after <= now),
                        and_(Task.status == "running", Task.lease_expires_at < now),
                    )
                )
                .order_by(Task.priority, Task.run_after)
                .limit(limit)
                .with_for_update(skip_locked=True)
            )
            tasks = list((await session.execute(stmt)).scalars())
            for t in tasks:
                t.status = "running"
                t.lease_owner = worker_id
                t.lease_expires_at = now + timedelta(seconds=self.lease_seconds)
                t.attempts += 1
                t.started_at = t.started_at or now
            await session.commit()
        for t in tasks:
            await self._publish_task(t)
        return tasks

    async def heartbeat(self, task_id: uuid.UUID, worker_id: str) -> bool:
        async with self.sessionmaker() as session:
            res = await session.execute(
                update(Task)
                .where(Task.id == task_id, Task.lease_owner == worker_id, Task.status == "running")
                .values(lease_expires_at=utcnow() + timedelta(seconds=self.lease_seconds))
            )
            await session.commit()
            return (res.rowcount or 0) > 0

    async def checkpoint(self, task_id: uuid.UUID, state: dict[str, Any], **fields: Any) -> None:
        async with self.sessionmaker() as session:
            await session.execute(update(Task).where(Task.id == task_id).values(state=state, **fields))
            await session.commit()

    async def add_usage(self, task_id: uuid.UUID, *, cost: float, input_tokens: int, output_tokens: int) -> None:
        async with self.sessionmaker() as session:
            await session.execute(
                update(Task)
                .where(Task.id == task_id)
                .values(cost_usd=Task.cost_usd + cost, input_tokens=Task.input_tokens + input_tokens,
                        output_tokens=Task.output_tokens + output_tokens)
            )
            await session.commit()

    async def _finish(self, task_id: uuid.UUID, status: str, **values: Any) -> Task | None:
        async with self.sessionmaker() as session:
            task = await session.get(Task, task_id)
            if task is None:
                return None
            task.status = status
            task.lease_owner = None
            task.lease_expires_at = None
            for k, v in values.items():
                setattr(task, k, v)
            if status in TERMINAL:
                task.finished_at = utcnow()
                TASKS.labels(task.kind, status).inc()
            await session.commit()
        await self._publish_task(task)
        return task

    async def complete(self, task_id: uuid.UUID, result: dict[str, Any] | None = None) -> Task | None:
        return await self._finish(task_id, "succeeded", result=result or {}, error=None)

    async def fail(self, task_id: uuid.UUID, error: str, *, retryable: bool = False) -> Task | None:
        async with self.sessionmaker() as session:
            task = await session.get(Task, task_id)
            if task is None:
                return None
            attempts, max_attempts = task.attempts, task.max_attempts
        if retryable and attempts < max_attempts:
            backoff = min(300, 5 * 3 ** (attempts - 1))
            return await self._finish(task_id, "queued", error=error, run_after=utcnow() + timedelta(seconds=backoff))
        return await self._finish(task_id, "failed", error=error)

    async def pause_for_approval(self, task_id: uuid.UUID, state: dict[str, Any]) -> Task | None:
        return await self._finish(task_id, "waiting_approval", state=state)

    async def release(self, task_id: uuid.UUID) -> None:
        """Give a running task back to the queue (graceful worker shutdown)."""
        async with self.sessionmaker() as session:
            await session.execute(
                update(Task).where(Task.id == task_id, Task.status == "running")
                .values(status="queued", lease_owner=None, lease_expires_at=None, attempts=Task.attempts - 1)
            )
            await session.commit()
        await self.wake()

    async def resume(self, task_id: uuid.UUID) -> None:
        async with self.sessionmaker() as session:
            await session.execute(
                update(Task).where(Task.id == task_id, Task.status == "waiting_approval")
                .values(status="queued", run_after=utcnow())
            )
            await session.commit()
        await self.wake()

    async def cancel(self, task_id: uuid.UUID, *, user_id: uuid.UUID | None = None) -> bool:
        async with self.sessionmaker() as session:
            task = await session.get(Task, task_id)
            if task is None or (user_id is not None and task.user_id != user_id) or task.status in TERMINAL:
                return False
            children = list((await session.execute(
                select(Task.id).where(Task.parent_id == task_id, Task.status.in_(ACTIVE))
            )).scalars())
            if task.status in ("queued", "waiting_approval"):
                task.status = "cancelled"
                task.finished_at = utcnow()
                TASKS.labels(task.kind, "cancelled").inc()
            else:
                task.cancel_requested = True
            await session.commit()
        await self._signal_cancel(task_id)
        await self._publish_task(task)
        for child in children:
            await self.cancel(child)
        return True

    async def _signal_cancel(self, task_id: uuid.UUID) -> None:
        self._local_cancel.add(str(task_id))
        if self.redis is not None:
            try:
                await self.redis.set(CANCEL_KEY.format(task_id), "1", ex=3600)
            except Exception:  # noqa: BLE001
                pass

    async def is_cancelled(self, task_id: uuid.UUID) -> bool:
        if str(task_id) in self._local_cancel:
            return True
        if self.redis is not None:
            try:
                if await self.redis.exists(CANCEL_KEY.format(task_id)):
                    return True
            except Exception:  # noqa: BLE001
                pass
        async with self.sessionmaker() as session:
            flag = (await session.execute(select(Task.cancel_requested).where(Task.id == task_id))).scalar()
            return bool(flag)

    # ------------------------------------------------------------------ events

    async def event(self, task: Task | uuid.UUID, type_: str, data: dict[str, Any], *, user_id: uuid.UUID | None = None,
                    conversation_id: uuid.UUID | None = None, persist: bool = True) -> None:
        task_id = task.id if isinstance(task, Task) else task
        if isinstance(task, Task):
            user_id = user_id or task.user_id
            conversation_id = conversation_id or task.conversation_id
        if persist:
            async with self.sessionmaker() as session:
                session.add(TaskEvent(task_id=task_id, type=type_, data=data))
                await session.commit()
        if user_id is not None:
            await self.bus.publish(
                user_id, make_event(type_, task_id=str(task_id),
                                    conversation_id=str(conversation_id) if conversation_id else None, data=data)
            )

    async def _publish_task(self, task: Task) -> None:
        await self.bus.publish(
            task.user_id,
            make_event(
                "task.updated",
                task_id=str(task.id),
                conversation_id=str(task.conversation_id) if task.conversation_id else None,
                data={"status": task.status, "kind": task.kind, "title": task.title, "error": task.error,
                      "parent_id": str(task.parent_id) if task.parent_id else None},
            ),
        )

    async def queue_depth(self) -> int:
        async with self.sessionmaker() as session:
            return int((await session.execute(text("SELECT count(*) FROM tasks WHERE status = 'queued'"))).scalar_one())
