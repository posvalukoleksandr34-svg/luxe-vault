"""Reminders and automations (scheduled / recurring work)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from jarvis.core.timeparse import ensure_future, next_cron, parse_local, to_local
from jarvis.tasks.scheduler import serialize_automation
from jarvis.tools.base import Risk, ToolContext, ToolError, tool

Channel = Literal["web", "telegram", "whatsapp"]


class ReminderArgs(BaseModel):
    text: str = Field(description="What to remind about, phrased for the user ('Купить молоко').")
    when: str | None = Field(None, description="Local date-time, ISO 8601 without offset, e.g. 2026-09-28T10:00. "
                                                "Required unless `cron` is given.")
    cron: str | None = Field(None, description="For recurring reminders: 5-field cron in the user's timezone "
                                                "('0 9 * * 1-5' = weekdays 09:00).")
    channels: list[Channel] | None = Field(None, description="Where to deliver; default = user's preferences.")

    @model_validator(mode="after")
    def _one_schedule(self):
        if not self.when and not self.cron:
            raise ValueError("give either `when` or `cron`")
        return self


def _reminder_summary(args: dict) -> str:
    return f"Напоминание «{args.get('text', '')}» — {args.get('when') or args.get('cron')}"


@tool(name="reminder_create", description="Create a one-off or recurring reminder delivered to the user's devices.",
      risk=Risk.WRITE, activity="Создаю напоминание", idempotent=False, summarize=_reminder_summary)
async def reminder_create(ctx: ToolContext, args: ReminderArgs) -> dict:
    if args.cron:
        next_cron(args.cron, ctx.timezone)  # validates
        a = await ctx.app.automations.create(
            user_id=ctx.user_id, name=args.text, kind="reminder", schedule_type="cron", cron=args.cron,
            timezone_name=ctx.timezone, payload={"message": args.text}, channels=args.channels,
            conversation_id=ctx.conversation_id)
    else:
        run_at = ensure_future(parse_local(args.when, ctx.timezone))
        a = await ctx.app.automations.create(
            user_id=ctx.user_id, name=args.text, kind="reminder", schedule_type="once", run_at=run_at,
            timezone_name=ctx.timezone, payload={"message": args.text}, channels=args.channels,
            conversation_id=ctx.conversation_id)
    return {"id": str(a.id), "text": args.text, "fires_at": to_local(a.next_run_at, ctx.timezone),
            "recurring": bool(args.cron)}


class ListArgs(BaseModel):
    include_disabled: bool = False


@tool(name="reminder_list", description="List upcoming reminders.", activity="Смотрю напоминания")
async def reminder_list(ctx: ToolContext, args: ListArgs) -> dict:
    items = await ctx.app.automations.list(ctx.user_id, kind="reminder", include_disabled=args.include_disabled)
    return {"reminders": [serialize_automation(a) for a in items]}


class RefArgs(BaseModel):
    id: str = Field(description="Reminder/automation id or its 8-char prefix.")


@tool(name="reminder_cancel", description="Cancel (delete) a reminder.", risk=Risk.WRITE,
      activity="Отменяю напоминание")
async def reminder_cancel(ctx: ToolContext, args: RefArgs) -> dict:
    a = await ctx.app.automations.delete(ctx.user_id, args.id)
    return {"deleted": str(a.id), "name": a.name}


class AutomationArgs(BaseModel):
    name: str = Field(description="Short name, e.g. 'Новости AI по понедельникам'.")
    prompt: str = Field(description="Self-contained instruction JARVIS will execute each run, including the "
                                    "desired output format. It will not see this conversation.")
    cron: str | None = Field(None, description="5-field cron in the user's timezone, e.g. '0 8 * * 1'.")
    run_at: str | None = Field(None, description="Local ISO datetime for a single future run.")
    interval_minutes: int | None = Field(None, ge=5)
    channels: list[Channel] | None = None

    @model_validator(mode="after")
    def _one_schedule(self):
        if sum(x is not None for x in (self.cron, self.run_at, self.interval_minutes)) != 1:
            raise ValueError("give exactly one of cron, run_at, interval_minutes")
        return self


def _automation_summary(args: dict) -> str:
    sched = args.get("cron") or args.get("run_at") or f"каждые {args.get('interval_minutes')} мин"
    return f"Автоматизация «{args.get('name')}» ({sched}): {str(args.get('prompt', ''))[:160]}"


@tool(name="automation_create",
      description="Schedule JARVIS to run a task automatically (periodic research, daily briefings, weekly reports). "
                  "Each run executes `prompt` with the same tools and permissions and delivers the result.",
      risk=Risk.WRITE, activity="Настраиваю автоматизацию", idempotent=False, summarize=_automation_summary)
async def automation_create(ctx: ToolContext, args: AutomationArgs) -> dict:
    kw: dict = {}
    if args.cron:
        kw = {"schedule_type": "cron", "cron": args.cron}
    elif args.run_at:
        kw = {"schedule_type": "once", "run_at": ensure_future(parse_local(args.run_at, ctx.timezone))}
    else:
        kw = {"schedule_type": "interval", "interval_seconds": int(args.interval_minutes) * 60}
    a = await ctx.app.automations.create(
        user_id=ctx.user_id, name=args.name, kind="agent", timezone_name=ctx.timezone,
        payload={"prompt": args.prompt}, channels=args.channels, conversation_id=ctx.conversation_id, **kw)
    return {"id": str(a.id), "name": a.name, "next_run": to_local(a.next_run_at, ctx.timezone)}


@tool(name="automation_list", description="List scheduled automations and recurring jobs.",
      activity="Смотрю автоматизации")
async def automation_list(ctx: ToolContext, args: ListArgs) -> dict:
    items = await ctx.app.automations.list(ctx.user_id, include_disabled=args.include_disabled)
    return {"automations": [serialize_automation(a) for a in items if a.kind == "agent"]}


class ToggleArgs(RefArgs):
    enabled: bool


@tool(name="automation_toggle", description="Pause or resume an automation.", risk=Risk.WRITE,
      activity="Меняю автоматизацию")
async def automation_toggle(ctx: ToolContext, args: ToggleArgs) -> dict:
    a = await ctx.app.automations.set_enabled(ctx.user_id, args.id, args.enabled)
    return {"id": str(a.id), "enabled": a.enabled}


@tool(name="automation_delete", description="Delete an automation permanently.", risk=Risk.WRITE,
      activity="Удаляю автоматизацию")
async def automation_delete(ctx: ToolContext, args: RefArgs) -> dict:
    a = await ctx.app.automations.delete(ctx.user_id, args.id)
    if a is None:
        raise ToolError("not found")
    return {"deleted": str(a.id), "name": a.name}
