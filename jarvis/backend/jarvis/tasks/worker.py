"""Worker process: executes tasks, runs the scheduler, polls Telegram (dev), hosts MCP clients.

    python -m jarvis.tasks.worker
"""

from __future__ import annotations

import asyncio
import contextlib
import signal
import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import update

from jarvis.agent.harness import RunOutcome
from jarvis.core.logging import configure_logging, log
from jarvis.db.models import Automation, Task
from jarvis.llm.types import LLMError

if TYPE_CHECKING:  # pragma: no cover
    from jarvis.core.container import AppContext


class Worker:
    def __init__(self, app: "AppContext", *, concurrency: int = 4, heartbeat_s: float = 30.0):
        self.app = app
        self.concurrency = concurrency
        self.heartbeat_s = heartbeat_s
        self.running: dict[uuid.UUID, asyncio.Task] = {}
        self._user_cancelled: set[uuid.UUID] = set()

    # ------------------------------------------------------------------ main loop

    async def run(self, stop: asyncio.Event, *, with_scheduler: bool = True, with_channels: bool = True) -> None:
        from jarvis.tasks.scheduler import scheduler_loop

        background: list[asyncio.Task] = []
        if with_scheduler:
            background.append(asyncio.create_task(scheduler_loop(self.app, stop)))
        if with_channels and self.app.settings.telegram_mode == "polling":
            tg = self.app.channels.adapters.get("telegram")
            if tg is not None:
                background.append(asyncio.create_task(tg.poll_forever(stop)))
        with contextlib.suppress(Exception):
            await self.app.mcp.start()
        log.info("worker.started", worker_id=self.app.worker_id, concurrency=self.concurrency)
        last_beat = 0.0
        try:
            while not stop.is_set():
                now = asyncio.get_running_loop().time()
                if now - last_beat > 10:
                    last_beat = now
                    await self._beat()
                for tid in [t for t, job in self.running.items() if job.done()]:
                    self.running.pop(tid, None)
                free = self.concurrency - len(self.running)
                claimed: list[Task] = []
                if free > 0:
                    try:
                        claimed = await self.app.tasks.claim(self.app.worker_id, limit=free)
                    except Exception:  # noqa: BLE001 - DB hiccup: back off and retry
                        log.exception("worker.claim_failed")
                        await asyncio.sleep(2)
                for task in claimed:
                    self.running[task.id] = asyncio.create_task(self._execute(task))
                if not claimed:
                    await self.app.tasks.wait_for_work(timeout=1.0 if self.running else 2.0)
        finally:
            for job in self.running.values():
                job.cancel()
            for tid, job in list(self.running.items()):
                with contextlib.suppress(BaseException):
                    await job
            for job in background:
                job.cancel()
            log.info("worker.stopped")

    async def _beat(self) -> None:
        if self.app.redis is None:
            return
        import json
        import time

        with contextlib.suppress(Exception):
            await self.app.redis.set(f"jarvis:workers:{self.app.worker_id}", json.dumps({
                "id": self.app.worker_id, "running": len(self.running), "concurrency": self.concurrency,
                "seen_at": time.time()}), ex=30)

    async def drain(self, timeout: float = 30.0) -> None:
        """Wait for running jobs (tests)."""
        deadline = asyncio.get_running_loop().time() + timeout
        while self.running and asyncio.get_running_loop().time() < deadline:
            await asyncio.sleep(0.05)
            for tid in [t for t, job in self.running.items() if job.done()]:
                self.running.pop(tid, None)

    # ------------------------------------------------------------------ one task

    async def _execute(self, task: Task) -> None:
        inner = asyncio.create_task(self._handle(task))
        watcher = asyncio.create_task(self._watch(task.id, inner))
        try:
            await inner
        except asyncio.CancelledError:
            if task.id in self._user_cancelled or await self.app.tasks.is_cancelled(task.id):
                await self.app.tasks._finish(task.id, "cancelled")
            else:
                await self.app.tasks.release(task.id)  # shutdown: another worker resumes it
                raise
        except LLMError as exc:
            log.warning("task.llm_error", task_id=str(task.id), error=str(exc), retryable=exc.retryable)
            final = await self.app.tasks.fail(task.id, str(exc), retryable=exc.retryable)
            if final is not None and final.status == "failed":
                await self._report_failure(task, str(exc))
        except Exception as exc:  # noqa: BLE001
            log.exception("task.crashed", task_id=str(task.id), kind=task.kind)
            await self.app.tasks.fail(task.id, f"{type(exc).__name__}: {exc}", retryable=False)
            await self._report_failure(task, f"{type(exc).__name__}")
        finally:
            watcher.cancel()
            self._user_cancelled.discard(task.id)

    async def _watch(self, task_id: uuid.UUID, inner: asyncio.Task) -> None:
        ticks = 0
        while not inner.done():
            await asyncio.sleep(0.5)
            ticks += 1
            if await self.app.tasks.is_cancelled(task_id):
                self._user_cancelled.add(task_id)
                inner.cancel()
                return
            if ticks % int(self.heartbeat_s * 2) == 0:
                await self.app.tasks.heartbeat(task_id, self.app.worker_id)

    async def _report_failure(self, task: Task, error: str) -> None:
        if task.kind in ("agent_turn", "command_run") and task.conversation_id:
            from jarvis.core.events import make_event

            await self.app.bus.publish(task.user_id, make_event(
                "agent.status", task_id=str(task.id), conversation_id=str(task.conversation_id),
                data={"state": "error", "label": f"Ошибка: {error[:200]}"}))
            conv = await self.app.conversations.get(task.user_id, task.conversation_id)
            if conv is not None:
                note = await self.app.conversations._store(conv, "notice", f"⚠️ Не удалось выполнить запрос: {error[:300]}",
                                                           task.channel, {"task_id": str(task.id)})
                await self.app.channels.deliver_reply(task, note)

    # ------------------------------------------------------------------ handlers

    async def _handle(self, task: Task) -> None:
        handler = {
            "agent_turn": self._agent,
            "background": self._background,
            "automation_run": self._automation,
            "memory_extract": self._memory_extract,
            "command_run": self._command,
        }.get(task.kind)
        if handler is None:
            await self.app.tasks.fail(task.id, f"unknown task kind {task.kind}")
            return
        await handler(task)

    async def _complete_agent(self, task: Task, outcome: RunOutcome) -> None:
        if outcome.status == "done":
            await self.app.tasks.complete(task.id, {"text": outcome.text, "message_id": outcome.message_id})
        elif outcome.status == "cancelled":
            await self.app.tasks._finish(task.id, "cancelled", result={"text": outcome.text})

    async def _command(self, task: Task) -> None:
        result = await self.app.commands.run(task)
        if await self.app.tasks.is_cancelled(task.id):
            await self.app.tasks._finish(task.id, "cancelled", result=result)
        else:
            await self.app.tasks.complete(task.id, result)

    async def _agent(self, task: Task) -> None:
        outcome = await self.app.runtime.run_task(task)
        await self._complete_agent(task, outcome)

    async def _background(self, task: Task) -> None:
        outcome = await self.app.runtime.run_task(task)
        await self._complete_agent(task, outcome)
        if outcome.status == "done":
            await self.app.channels.notify(task.user_id, f"✅ Готово: {task.title}", outcome.text[:1500],
                                           source="task", ref=str(task.id))

    async def _automation(self, task: Task) -> None:
        inp = task.input or {}
        automation_id = inp.get("automation_id")
        payload = inp.get("payload") or {}
        channels = inp.get("channels") or None
        if inp.get("kind") == "reminder":
            message = payload.get("message", "Напоминание")
            late = int(inp.get("late_seconds") or 0)
            body = "" if late < 600 else f"(с опозданием на {late // 60} мин — система была недоступна)"
            await self.app.channels.notify(task.user_id, f"⏰ {message}", body, channels=channels, source="reminder",
                                           ref=automation_id)
            conv = await self.app.conversations.primary(task.user_id)
            await self.app.conversations._store(conv, "notice", f"⏰ Напоминание: {message}", "automation",
                                                {"automation_id": automation_id})
            await self.app.tasks.complete(task.id, {"delivered": True})
            status = "delivered"
        else:
            if not (task.state or {}).get("v"):
                conv = task.conversation_id or (await self.app.conversations.primary(task.user_id)).id
                async with self.app.sessionmaker() as session:
                    await session.execute(update(Task).where(Task.id == task.id).values(
                        conversation_id=conv, input={**inp, "prompt": payload.get("prompt", ""), "agent": "jarvis"}))
                    await session.commit()
                    task = await session.get(Task, task.id)
            outcome = await self.app.runtime.run_task(task)
            await self._complete_agent(task, outcome)
            status = outcome.status
            if outcome.status == "done":
                await self.app.channels.notify(task.user_id, f"🤖 {task.title}", outcome.text[:3500],
                                               channels=channels, source="automation", ref=automation_id)
        if automation_id:
            async with self.app.sessionmaker() as session:
                await session.execute(update(Automation).where(Automation.id == uuid.UUID(automation_id))
                                      .values(last_status=status))
                await session.commit()

    async def _memory_extract(self, task: Task) -> None:
        inp = task.input or {}
        stored = await self.app.extractor.process_turn(
            inp.get("user_text", ""), inp.get("assistant_text", ""), user_id=task.user_id,
            source_ref=inp.get("source_ref"), task_id=task.id)
        await self.app.tasks.complete(task.id, {"stored": [str(m.id) for m in stored]})


async def main() -> None:
    from jarvis.core.container import build_app
    from jarvis.settings import get_settings

    settings = get_settings()
    configure_logging(settings.log_level, settings.log_json)
    app = await build_app(settings)
    if settings.worker_id:
        app.worker_id = settings.worker_id
    if settings.metrics_port:
        from prometheus_client import start_http_server

        start_http_server(settings.metrics_port)  # scraped by Prometheus on the internal network

    async def warm_embeddings() -> None:
        # first use of the local embedding model downloads it (~220 MB) — do it now, not mid-conversation
        with contextlib.suppress(Exception):
            await app.embedder.embed(["warm-up"])

    asyncio.get_running_loop().create_task(warm_embeddings())
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)
    worker = Worker(app, concurrency=settings.worker_concurrency)
    try:
        await worker.run(stop)
    finally:
        await app.close()


def _run() -> Any:
    asyncio.run(main())


if __name__ == "__main__":
    _run()
