"""Core tools that are always present: time, memory, skills, delegation, background tasks, notifications."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy import String, cast, select

from jarvis.core.timeparse import tz
from jarvis.db.models import MEMORY_KINDS, Memory, Task
from jarvis.tools.base import Risk, ToolContext, ToolError, tool

MemoryKind = Literal["profile", "semantic", "episodic", "project", "relationship", "important"]


# ----------------------------------------------------------------------------------------- time


class NoArgs(BaseModel):
    pass


@tool(name="time_now", description="Current date and time in the user's timezone.", activity="Смотрю время")
async def time_now(ctx: ToolContext, args: NoArgs) -> dict:
    now = datetime.now(tz(ctx.timezone))
    return {"iso": now.isoformat(timespec="seconds"), "weekday": now.strftime("%A"), "timezone": ctx.timezone}


# ----------------------------------------------------------------------------------------- memory


class RememberArgs(BaseModel):
    content: str = Field(description="One self-contained fact in the user's language, third person "
                                     "(e.g. 'Пользователь любит зелёный чай').")
    kind: MemoryKind = Field("semantic", description="profile=who the user is/preferences; relationship=people; "
                                                     "project; important=critical facts; episodic=dated event")
    subject: str | None = Field(None, description="Who/what the fact is about: 'user', a person's name, a project.")
    importance: float = Field(0.6, ge=0, le=1)
    pinned: bool = Field(False, description="Always keep in context (only for truly core facts).")


@tool(name="memory_remember", description="Save a durable fact to long-term memory (de-duplicated automatically).",
      risk=Risk.WRITE, activity="Запоминаю", idempotent=True, parallel_safe=True)
async def memory_remember(ctx: ToolContext, args: RememberArgs) -> dict:
    mem, created = await ctx.app.memory.add(
        ctx.user_id, args.content, kind=args.kind, subject=args.subject, importance=args.importance,
        pinned=args.pinned, source="explicit", source_ref=str(ctx.task_id) if ctx.task_id else None,
    )
    return {"id": str(mem.id), "created": created, "content": mem.content,
            "note": "saved" if created else "already known — reinforced existing memory"}


class SearchArgs(BaseModel):
    query: str = Field(description="What to look for, in natural language.")
    kind: MemoryKind | None = None
    limit: int = Field(8, ge=1, le=25)


@tool(name="memory_search", description="Search long-term memory about the user, people, projects and past events.",
      activity="Вспоминаю")
async def memory_search(ctx: ToolContext, args: SearchArgs) -> dict:
    found = await ctx.app.memory.search(ctx.user_id, args.query, limit=args.limit,
                                        kinds=[args.kind] if args.kind else None)
    return {"results": [r.as_dict() for r in found], "count": len(found)}


async def _resolve_memory(ctx: ToolContext, ref: str) -> Memory:
    ref = ref.strip()
    async with ctx.app.sessionmaker() as session:
        try:
            mem = await session.get(Memory, uuid.UUID(ref))
        except ValueError:
            rows = list((await session.execute(
                select(Memory).where(Memory.user_id == ctx.user_id, Memory.status == "active",
                                     cast(Memory.id, String).like(f"{ref}%")).limit(2)
            )).scalars())
            if len(rows) > 1:
                raise ToolError("memory id prefix is ambiguous; use more characters") from None
            mem = rows[0] if rows else None
    if mem is None or mem.user_id != ctx.user_id or mem.status != "active":
        raise ToolError(f"memory {ref!r} not found")
    return mem


class UpdateArgs(BaseModel):
    memory_id: str = Field(description="Full id or the 8-char prefix shown in recalled memories.")
    content: str | None = None
    kind: MemoryKind | None = None
    importance: float | None = Field(None, ge=0, le=1)
    pinned: bool | None = None


@tool(name="memory_update", description="Correct or refine an existing memory.", risk=Risk.WRITE,
      activity="Обновляю память", idempotent=True)
async def memory_update(ctx: ToolContext, args: UpdateArgs) -> dict:
    mem = await _resolve_memory(ctx, args.memory_id)
    updated = await ctx.app.memory.update(ctx.user_id, mem.id, content=args.content, kind=args.kind,
                                          importance=args.importance, pinned=args.pinned)
    return {"id": str(mem.id), "content": updated.content if updated else mem.content}


class ForgetArgs(BaseModel):
    memory_id: str


@tool(name="memory_forget", description="Delete a memory the user wants forgotten or that is wrong.",
      risk=Risk.WRITE, activity="Удаляю из памяти", idempotent=True)
async def memory_forget(ctx: ToolContext, args: ForgetArgs) -> dict:
    mem = await _resolve_memory(ctx, args.memory_id)
    await ctx.app.memory.delete(ctx.user_id, mem.id)
    return {"deleted": str(mem.id), "content": mem.content}


# ----------------------------------------------------------------------------------------- skills & agents


class SkillLoadArgs(BaseModel):
    name: str = Field(description="Skill name from the installed skills list.")


@tool(name="skill_load", description="Load the full instructions of an installed skill before using it.",
      activity="Загружаю навык")
async def skill_load(ctx: ToolContext, args: SkillLoadArgs) -> str:
    text = ctx.app.skills.instructions(args.name)
    if text is None:
        raise ToolError(f"skill {args.name!r} is not installed or disabled",
                        hint="available: " + ", ".join(s.name for s in ctx.app.skills.enabled()))
    return text


class DelegateArgs(BaseModel):
    agent: Literal["research", "browser", "coding", "planner"] = Field(
        description="research: web research reports; browser: operate web pages; coding: write/run code in the "
                    "sandbox; planner: analyse calendar/reminders and propose a plan (read-only).")
    task: str = Field(description="Complete, self-contained instructions including the expected output format.")


@tool(name="agent_delegate",
      description="Hand a focused sub-task to a specialist agent and get its report back. Use for work that would "
                  "flood the conversation with intermediate steps (many searches, page navigation, code iterations).",
      activity="Передаю задачу специалисту", timeout_s=900, parallel_safe=True)
async def agent_delegate(ctx: ToolContext, args: DelegateArgs) -> dict:
    await ctx.progress(f"Запущен агент: {args.agent}")
    return await ctx.app.runtime.run_subagent(ctx, args.agent, args.task)


class SpawnArgs(BaseModel):
    title: str = Field(description="Short title shown in the task list.")
    instructions: str = Field(description="Self-contained instructions; the background run does not see this chat.")
    agent: Literal["jarvis", "research", "coding", "browser", "planner"] = "jarvis"


@tool(name="task_spawn_background",
      description="Start a long-running task in the background (reports, research, multi-step jobs). The result is "
                  "posted to this conversation and the user is notified when it finishes.",
      risk=Risk.WRITE, activity="Запускаю фоновую задачу", idempotent=False)
async def task_spawn_background(ctx: ToolContext, args: SpawnArgs) -> dict:
    prompt = args.instructions
    if args.agent != "jarvis":
        prompt = (f"Use agent_delegate with agent='{args.agent}' to do the following, then present the result to "
                  f"the user:\n\n{args.instructions}")
    task = await ctx.app.tasks.create(
        user_id=ctx.user_id, kind="background", title=args.title, conversation_id=ctx.conversation_id,
        parent_id=None, channel=ctx.channel, priority=150, input={"prompt": prompt, "agent": "jarvis"},
    )
    return {"task_id": str(task.id), "status": "queued", "title": args.title}


class TaskRef(BaseModel):
    task_id: str = Field(description="Task id or its 8-char prefix.")


async def _resolve_task(ctx: ToolContext, ref: str) -> Task:
    async with ctx.app.sessionmaker() as session:
        rows = list((await session.execute(
            select(Task).where(Task.user_id == ctx.user_id, cast(Task.id, String).like(f"{ref.strip()}%")).limit(2)
        )).scalars())
    if len(rows) != 1:
        raise ToolError("task not found" if not rows else "ambiguous task id")
    return rows[0]


@tool(name="task_status", description="Check the status/result of a background task.", activity="Проверяю задачу")
async def task_status(ctx: ToolContext, args: TaskRef) -> dict:
    t = await _resolve_task(ctx, args.task_id)
    return {"task_id": str(t.id), "title": t.title, "status": t.status, "error": t.error,
            "result": (t.result or {}).get("text", "")[:2000], "cost_usd": round(t.cost_usd, 4)}


@tool(name="task_cancel", description="Cancel a queued, running or waiting task.", risk=Risk.WRITE,
      activity="Отменяю задачу")
async def task_cancel(ctx: ToolContext, args: TaskRef) -> dict:
    t = await _resolve_task(ctx, args.task_id)
    ok = await ctx.app.tasks.cancel(t.id, user_id=ctx.user_id)
    return {"task_id": str(t.id), "cancelled": ok}


# ----------------------------------------------------------------------------------------- notify


class NotifyArgs(BaseModel):
    title: str
    body: str = ""
    channels: list[Literal["web", "telegram", "whatsapp"]] | None = Field(
        None, description="Defaults to the user's notification preferences.")


@tool(name="notify_user", description="Send the user a notification on their devices (web, Telegram, WhatsApp).",
      risk=Risk.WRITE, activity="Отправляю уведомление", idempotent=False)
async def notify_user(ctx: ToolContext, args: NotifyArgs) -> dict:
    note = await ctx.app.channels.notify(ctx.user_id, args.title, args.body, channels=args.channels,
                                         source="agent", ref=str(ctx.task_id) if ctx.task_id else None)
    return {"notification_id": str(note.id), "delivered": note.delivered}


assert set(MEMORY_KINDS) == {"profile", "semantic", "episodic", "project", "relationship", "important"}
