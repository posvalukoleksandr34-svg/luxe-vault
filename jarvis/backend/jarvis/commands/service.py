"""Custom commands: user-defined macros ("Gaming mode", "Доброе утро").

    trigger phrase ──(exact match after normalisation, no model call)──► command_run task ──► steps

A step is one of:
    {"type": "tool",   "tool": "computer_open_app", "args": {"name": "spotify"}}   any registered tool
    {"type": "wait",   "seconds": 2}                                               ≤ 120 s
    {"type": "say",    "text": "Игровой режим активирован."}                        spoken / shown reply
    {"type": "notify", "text": "…"}                                                 push to the user's channels
    {"type": "agent",  "text": "Сделай утренний брифинг: погода, календарь"}        hand a prompt to the agent
Every step may carry `when` (always | device_online | device_offline | weekday | weekend | morning |
afternoon | evening) and `continue_on_error`.

Security: tool steps go through the same executor, permission policy, tool-call log and audit log as the
agent's own tool calls. Tiers are checked when the command is saved *and* again on every run (rules may
have changed): forbidden/restricted tools are never allowed in a command; confirm-tier tools only if the
command was pre-approved from an elevated (re-authenticated) session.
"""

from __future__ import annotations

import asyncio
import re
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any, Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field, ValidationError, model_validator
from sqlalchemy import func, select, update

from jarvis.core.audit import audit
from jarvis.core.logging import log
from jarvis.db.base import utcnow
from jarvis.db.models import CustomCommand, Task, User
from jarvis.tools.base import Tier, ToolContext, ToolError

if TYPE_CHECKING:
    from jarvis.core.container import AppContext

MAX_STEPS = 25
# not allowed as command steps: commands calling commands (loops) and agent-internal plumbing
NOT_STEPPABLE = ("command_", "agent_delegate", "task_", "skill_load")
MAX_COMMANDS_DEFAULT = 100
WAKE = re.compile(r"^\s*(?:hey\s+|эй\s+|ok\s+|окей\s+)?(?:jarvis|джарвис|джервис|жарвис)\b[\s,!.:-]*", re.I)
Condition = Literal["always", "device_online", "device_offline", "weekday", "weekend", "morning", "afternoon", "evening"]


def normalize(text: str) -> str:
    """'JARVIS, включи игровой режим!' → 'включи игровой режим'."""
    t = WAKE.sub("", text.strip())
    t = re.sub(r"[^\w\s]", " ", t.lower().replace("ё", "е"))
    return re.sub(r"\s+", " ", t).strip()


class Step(BaseModel):
    type: Literal["tool", "wait", "say", "notify", "agent"]
    tool: str | None = None
    args: dict[str, Any] = Field(default_factory=dict)
    seconds: float | None = Field(None, ge=0, le=120)
    text: str | None = Field(None, max_length=4000)
    when: Condition = "always"
    continue_on_error: bool = False

    @model_validator(mode="after")
    def _shape(self) -> "Step":
        if self.type == "tool" and not self.tool:
            raise ValueError("tool step needs `tool`")
        if self.type == "wait" and self.seconds is None:
            raise ValueError("wait step needs `seconds`")
        if self.type in ("say", "notify", "agent") and not (self.text or "").strip():
            raise ValueError(f"{self.type} step needs `text`")
        return self


class CommandIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field("", max_length=1000)
    triggers: list[str] = Field(min_length=1, max_length=20)
    steps: list[Step] = Field(min_length=1, max_length=MAX_STEPS)
    response: str = Field("", max_length=1000)
    enabled: bool = True
    preapproved: bool = False


class CommandError(ValueError):
    pass


def serialize(c: CustomCommand) -> dict[str, Any]:
    return {"id": str(c.id), "name": c.name, "description": c.description, "triggers": c.triggers, "steps": c.steps,
            "response": c.response, "enabled": c.enabled, "preapproved": c.preapproved, "run_count": c.run_count,
            "last_run_at": c.last_run_at.isoformat() if c.last_run_at else None, "last_status": c.last_status,
            "updated_at": c.updated_at.isoformat() if c.updated_at else None}


class CommandService:
    def __init__(self, app: "AppContext"):
        self.app = app

    # ------------------------------------------------------------------ CRUD

    async def list(self, user_id: uuid.UUID) -> list[CustomCommand]:
        async with self.app.sessionmaker() as session:
            return list((await session.execute(select(CustomCommand).where(CustomCommand.user_id == user_id)
                                               .order_by(CustomCommand.name))).scalars())

    async def get(self, user_id: uuid.UUID, command_id: uuid.UUID | str) -> CustomCommand | None:
        async with self.app.sessionmaker() as session:
            row = await session.get(CustomCommand, uuid.UUID(str(command_id)))
            return row if row is not None and row.user_id == user_id else None

    async def find(self, user_id: uuid.UUID, name: str) -> CustomCommand | None:
        wanted = normalize(name)
        for c in await self.list(user_id):
            if normalize(c.name) == wanted or wanted in {normalize(t) for t in c.triggers}:
                return c
        return None

    async def validate(self, user_id: uuid.UUID, body: CommandIn, *, elevated: bool) -> list[str]:
        """Raise CommandError when the command must not be saved; return warnings otherwise."""
        warnings: list[str] = []
        triggers = [normalize(t) for t in body.triggers if normalize(t)]
        if not triggers:
            raise CommandError("at least one trigger phrase is required")
        async with self.app.sessionmaker() as session:
            rules = await self.app.policy.user_rules(session, user_id, "web")
        needs_confirm = []
        for i, step in enumerate(body.steps, 1):
            if step.type != "tool":
                continue
            spec = self.app.registry.get(step.tool or "")
            if spec is None:
                raise CommandError(f"step {i}: unknown tool {step.tool!r}")
            if spec.name.startswith(NOT_STEPPABLE):
                raise CommandError(f"step {i}: {spec.name} cannot be used inside a command")
            try:
                self.app.executor.validate(spec, step.args)
            except ToolError as exc:
                raise CommandError(f"step {i} ({spec.name}): {exc}") from exc
            tier = self.app.policy.decide(spec, rules=rules).tier
            if tier in (Tier.FORBIDDEN, Tier.RESTRICTED):
                raise CommandError(f"step {i}: {spec.name} is {tier.value} and cannot be part of a command")
            if tier == Tier.CONFIRM:
                needs_confirm.append(spec.name)
        if needs_confirm and body.preapproved and not elevated:
            raise CommandError("pre-approving confirm-level actions requires re-authentication (elevate) first")
        if needs_confirm and not body.preapproved:
            warnings.append(f"{', '.join(sorted(set(needs_confirm)))} need confirmation — these steps will be skipped "
                            "unless the command is pre-approved")
        # trigger collisions with the user's other commands
        mine = await self.list(user_id)
        taken = {normalize(t): c.name for c in mine if normalize(c.name) != normalize(body.name) for t in c.triggers}
        clash = [t for t in triggers if t in taken]
        if clash:
            raise CommandError(f"trigger '{clash[0]}' is already used by command '{taken[clash[0]]}'")
        return warnings

    async def save(self, user_id: uuid.UUID, body: CommandIn, *, elevated: bool,
                   command_id: uuid.UUID | None = None, max_commands: int = MAX_COMMANDS_DEFAULT) -> tuple[CustomCommand, list[str]]:
        warnings = await self.validate(user_id, body, elevated=elevated)
        async with self.app.sessionmaker() as session:
            if command_id is not None:
                row = await session.get(CustomCommand, command_id)
                if row is None or row.user_id != user_id:
                    raise LookupError("command not found")
                if body.preapproved and not row.preapproved and not elevated:
                    raise CommandError("pre-approving requires re-authentication")
            else:
                count = (await session.execute(select(func.count()).select_from(CustomCommand)
                                               .where(CustomCommand.user_id == user_id))).scalar_one()
                if count >= max_commands:
                    raise CommandError(f"command limit reached ({max_commands})")
                row = CustomCommand(user_id=user_id)
                session.add(row)
            row.name = body.name.strip()
            row.description = body.description
            row.triggers = [t.strip() for t in body.triggers if t.strip()]
            row.steps = [s.model_dump(exclude_none=True) for s in body.steps]
            row.response = body.response
            row.enabled = body.enabled
            row.preapproved = body.preapproved
            await session.flush()
            await audit(session, action="command.saved", actor="user", user_id=user_id, target=row.name,
                        data={"id": str(row.id), "steps": len(row.steps), "preapproved": row.preapproved})
            await session.commit()
            return row, warnings

    async def delete(self, user_id: uuid.UUID, command_id: uuid.UUID) -> bool:
        async with self.app.sessionmaker() as session:
            row = await session.get(CustomCommand, command_id)
            if row is None or row.user_id != user_id:
                return False
            await session.delete(row)
            await audit(session, action="command.deleted", actor="user", user_id=user_id, target=row.name)
            await session.commit()
            return True

    # ------------------------------------------------------------------ matching

    async def match(self, user_id: uuid.UUID, text: str) -> CustomCommand | None:
        said = normalize(text)
        if not said or len(said) > 200:
            return None
        for c in await self.list(user_id):
            if c.enabled and said in {normalize(t) for t in c.triggers}:
                return c
        return None

    # ------------------------------------------------------------------ running

    async def start(self, user_id: uuid.UUID, command: CustomCommand, *, channel: str = "web",
                    conversation_id: uuid.UUID | None = None, message_id: str | None = None,
                    reply_to: str | None = None) -> Task:
        return await self.app.tasks.create(
            user_id=user_id, kind="command_run", title=f"Команда: {command.name}", conversation_id=conversation_id,
            channel=channel, priority=5, max_attempts=1,  # never repeat side effects automatically
            input={"command_id": str(command.id), "message_id": message_id, "reply_to": reply_to})

    async def _condition(self, user: User, when: str) -> bool:
        if when == "always":
            return True
        if when in ("device_online", "device_offline"):
            online = bool(await self.app.devices.devices(user.id))
            return online if when == "device_online" else not online
        now = datetime.now(ZoneInfo(user.timezone or "UTC"))
        return {"weekday": now.weekday() < 5, "weekend": now.weekday() >= 5, "morning": 5 <= now.hour < 12,
                "afternoon": 12 <= now.hour < 18, "evening": now.hour >= 18 or now.hour < 5}.get(when, True)

    async def run(self, task: Task) -> dict[str, Any]:
        """Execute a command_run task. Returns the result stored on the task."""
        app = self.app
        async with app.sessionmaker() as session:
            user = await session.get(User, task.user_id)
            cmd = await session.get(CustomCommand, uuid.UUID(task.input["command_id"]))
        if cmd is None or cmd.user_id != task.user_id or user is None:
            raise CommandError("command no longer exists")
        async with app.sessionmaker() as session:
            rules = await app.policy.user_rules(session, user.id, task.channel)
        await app.tasks.event(task, "agent.status", {"state": "executing", "label": f"Выполняю «{cmd.name}»"},
                              persist=False)
        lines: list[str] = []
        spoken: list[str] = []
        trace: list[dict[str, Any]] = []
        ok_all, failed = True, 0
        for i, raw in enumerate(cmd.steps, 1):
            if await app.tasks.is_cancelled(task.id):
                lines.append("⏹ Остановлено.")
                ok_all = False
                break
            try:
                step = Step.model_validate(raw)
            except ValidationError as exc:
                lines.append(f"✗ шаг {i}: неверный шаг ({exc.errors()[0]['msg']})")
                ok_all, failed = False, failed + 1
                break
            if not await self._condition(user, step.when):
                continue
            ok, line = await self._run_step(task, user, cmd, step, i, rules, trace, spoken)
            if line:
                lines.append(line)
            if not ok:
                ok_all, failed = False, failed + 1
                if not step.continue_on_error:
                    if i < len(cmd.steps):
                        lines.append(f"Остальные шаги ({len(cmd.steps) - i}) пропущены.")
                    break
        status = "ok" if ok_all else ("partial" if failed < len(cmd.steps) else "failed")
        async with app.sessionmaker() as session:
            await session.execute(update(CustomCommand).where(CustomCommand.id == cmd.id).values(
                run_count=CustomCommand.run_count + 1, last_run_at=utcnow(), last_status=status))
            await audit(session, action="command.run", actor="user", user_id=user.id, target=cmd.name,
                        data={"status": status, "task_id": str(task.id), "channel": task.channel}, trace_id=task.trace_id)
            await session.commit()
        if ok_all:
            head = cmd.response.strip() or " ".join(spoken) or f"Готово: «{cmd.name}»."
        else:
            head = f"«{cmd.name}» выполнена не полностью." if status == "partial" else f"«{cmd.name}» не выполнена."
        body = head if (ok_all and not [ln for ln in lines if ln.startswith("✗")]) else head + "\n" + "\n".join(lines)
        text = body.strip()
        if task.conversation_id:
            conv = await app.conversations.get(user.id, task.conversation_id)
            if conv is not None:
                msg = await app.runtime._save_message(task, conv, text, {"trace": trace, "route": "command"},
                                                      meta={"command": cmd.name, "status": status})
                await app.channels.deliver_reply(task, msg)
        await app.tasks.event(task, "agent.status", {"state": "done" if ok_all else "error",
                                                     "label": "Готово" if ok_all else "Выполнено не полностью"},
                              persist=False)
        log.info("command.run", command=cmd.name, status=status, steps=len(cmd.steps), task_id=str(task.id))
        return {"status": status, "text": text}

    async def _run_step(self, task: Task, user: User, cmd: CustomCommand, step: Step, i: int,
                        rules: dict[str, Tier], trace: list[dict[str, Any]], spoken: list[str]) -> tuple[bool, str]:
        app = self.app
        if step.type == "wait":
            await asyncio.sleep(step.seconds or 0)
            return True, ""
        if step.type == "say":
            spoken.append(step.text or "")
            return True, ""
        if step.type == "notify":
            await app.channels.notify(user.id, step.text or "", source="command", ref=str(cmd.id))
            return True, f"✓ уведомление: {(step.text or '')[:60]}"
        if step.type == "agent":
            child = await app.tasks.create(
                user_id=user.id, kind="background", title=(step.text or "")[:120], conversation_id=task.conversation_id,
                parent_id=task.id, channel=task.channel, priority=100, input={"prompt": step.text, "agent": "jarvis"})
            return True, f"✓ задача для JARVIS запущена: {(step.text or '')[:60]} (#{str(child.id)[:8]})"

        spec = app.registry.get(step.tool or "")
        if spec is None:
            return False, f"✗ шаг {i}: инструмент {step.tool} больше не существует"
        avail = await app.availability(user.id)
        missing = [r for r in spec.requires if not avail.get(r)]
        if missing:
            hint = "компьютер не подключён" if any(r.startswith("computer") for r in missing) else ", ".join(missing)
            return False, f"✗ {_label(spec.activity or spec.name, step.args)}: недоступно ({hint})"
        tier = app.policy.decide(spec, rules=rules).tier
        if tier in (Tier.FORBIDDEN, Tier.RESTRICTED):
            return False, f"✗ {spec.name}: запрещено политикой ({tier.value})"
        if tier == Tier.CONFIRM and not cmd.preapproved:
            return False, (f"✗ {_label(spec.activity or spec.name, step.args)}: требует подтверждения — включите "
                           "«Разрешить без подтверждения» в команде")
        tool_use_id = f"cmd_{uuid.uuid4().hex[:20]}"
        tu = {"id": tool_use_id, "name": spec.name, "input": step.args}
        await app.runtime._record_call(task, tu, spec, tier, "running", None)
        await app.tasks.event(task, "tool.started", {"tool": spec.name, "activity": spec.activity or spec.name,
                                                     "tool_use_id": tool_use_id, "summary": spec.describe(step.args)[:300]})

        async def emit(type_: str, data: dict[str, Any]) -> None:
            await app.tasks.event(task, type_, {**data, "tool_use_id": tool_use_id}, persist=False)

        ctx = ToolContext(app=app, user_id=user.id, task_id=task.id, conversation_id=task.conversation_id,
                          channel=task.channel, timezone=user.timezone, trace_id=task.trace_id,
                          tool_use_id=tool_use_id, emit=emit)
        outcome = await app.executor.execute(spec, step.args, ctx)
        await app.runtime._update_call(tool_use_id, "succeeded" if outcome.ok else "failed",
                                       {"content": outcome.content, "data": outcome.data}, outcome.error,
                                       duration_ms=outcome.duration_ms, attempts=outcome.attempts)
        await app.tasks.event(task, "tool.finished", {"tool": spec.name, "ok": outcome.ok, "tool_use_id": tool_use_id,
                                                      "duration_ms": outcome.duration_ms, "error": outcome.error})
        trace.append({"id": tool_use_id, "name": spec.name, "input": step.args, "ok": outcome.ok,
                      "result": outcome.content[:600]})
        if spec.risk.value != "read":
            async with app.sessionmaker() as session:
                await audit(session, action="tool.executed", actor="command", user_id=user.id, target=spec.name,
                            data={"ok": outcome.ok, "command": cmd.name, "task_id": str(task.id), "args": step.args,
                                  "error": outcome.error}, trace_id=task.trace_id)
                await session.commit()
        label = _label(spec.activity or spec.name, step.args)
        if outcome.ok:
            return True, f"✓ {label}"
        return False, f"✗ {label}: {outcome.error}"


def _label(activity: str, args: dict[str, Any]) -> str:
    """'Запускаю приложение' + {'name': 'spotify'} → 'Запускаю приложение: spotify'."""
    for key in ("name", "url", "search", "query", "location", "level", "action", "title", "text"):
        if args.get(key) not in (None, ""):
            value = str(args[key])
            return f"{activity}: {value[:60]}" + ("%" if key == "level" else "")
    return activity
