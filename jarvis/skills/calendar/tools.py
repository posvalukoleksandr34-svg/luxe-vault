"""Calendar tools. The provider (Google / built-in) is chosen per user at call time."""

from __future__ import annotations

from datetime import time, timedelta

from pydantic import BaseModel, Field

from jarvis.core.timeparse import parse_local, to_local
from jarvis.integrations.calendar import find_free_slots, get_calendar
from jarvis.tools.base import Risk, ToolContext, ToolError, tool


class Range(BaseModel):
    start: str = Field(description="Local ISO datetime, e.g. 2026-09-28T00:00")
    end: str = Field(description="Local ISO datetime (exclusive)")
    query: str | None = Field(None, description="Optional text filter")


@tool(name="calendar_list_events", description="List calendar events between two local datetimes.",
      activity="Проверяю календарь", timeout_s=30, retries=1)
async def calendar_list_events(ctx: ToolContext, args: Range) -> dict:
    cal = await get_calendar(ctx.app, ctx.user_id, ctx.timezone)
    start, end = parse_local(args.start, ctx.timezone), parse_local(args.end, ctx.timezone)
    if end <= start:
        raise ToolError("end must be after start")
    events = await cal.list(start, end, args.query)
    return {"calendar": cal.name, "events": [e.as_dict(ctx.timezone) for e in events], "count": len(events)}


class CreateEvent(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    start: str = Field(description="Local ISO datetime")
    end: str | None = Field(None, description="Local ISO datetime; default start + configured duration")
    description: str = ""
    location: str = ""
    attendees: list[str] = Field(default_factory=list, description="E-mails to invite (sends invitations)")


def _create_summary(a: dict) -> str:
    who = f", приглашения: {', '.join(a.get('attendees') or [])}" if a.get("attendees") else ""
    return f"Событие «{a.get('title')}» {a.get('start')}{who}"


@tool(name="calendar_create_event", description="Create a calendar event.", risk=Risk.WRITE,
      activity="Создаю событие", timeout_s=30, idempotent=False, summarize=_create_summary)
async def calendar_create_event(ctx: ToolContext, args: CreateEvent) -> dict:
    cfg = ctx.app.skills.config("calendar")
    start = parse_local(args.start, ctx.timezone)
    end = parse_local(args.end, ctx.timezone) if args.end else start + timedelta(
        minutes=int(cfg.get("default_duration_minutes", 60)))
    if end <= start:
        raise ToolError("end must be after start")
    cal = await get_calendar(ctx.app, ctx.user_id, ctx.timezone)
    event = await cal.create(title=args.title, start=start, end=end, description=args.description,
                             location=args.location, attendees=args.attendees)
    return {"calendar": cal.name, "event": event.as_dict(ctx.timezone),
            "when": f"{to_local(event.start, ctx.timezone)} – {to_local(event.end, ctx.timezone)[11:16]}"}


class UpdateEvent(BaseModel):
    event_id: str
    title: str | None = None
    start: str | None = None
    end: str | None = None
    description: str | None = None
    location: str | None = None


@tool(name="calendar_update_event", description="Move or edit an existing event.", risk=Risk.WRITE,
      activity="Переношу событие", timeout_s=30, idempotent=True)
async def calendar_update_event(ctx: ToolContext, args: UpdateEvent) -> dict:
    cal = await get_calendar(ctx.app, ctx.user_id, ctx.timezone)
    fields = args.model_dump(exclude={"event_id"}, exclude_none=True)
    for key in ("start", "end"):
        if key in fields:
            fields[key] = parse_local(fields[key], ctx.timezone)
    event = await cal.update(args.event_id, **fields)
    return {"calendar": cal.name, "event": event.as_dict(ctx.timezone)}


class EventRef(BaseModel):
    event_id: str


@tool(name="calendar_delete_event", description="Cancel/delete an event.", risk=Risk.WRITE,
      activity="Отменяю событие", timeout_s=30)
async def calendar_delete_event(ctx: ToolContext, args: EventRef) -> dict:
    cal = await get_calendar(ctx.app, ctx.user_id, ctx.timezone)
    await cal.delete(args.event_id)
    return {"deleted": args.event_id}


class FreeTime(BaseModel):
    start: str = Field(description="Local ISO datetime where the search begins")
    end: str = Field(description="Local ISO datetime where the search ends")
    duration_minutes: int = Field(60, ge=5, le=720)
    working_hours: str | None = Field(None, description="HH:MM-HH:MM, default from skill config")


@tool(name="calendar_find_free_time", description="Find free time slots of a given length.",
      activity="Ищу свободное время", timeout_s=30, retries=1)
async def calendar_find_free_time(ctx: ToolContext, args: FreeTime) -> dict:
    cal = await get_calendar(ctx.app, ctx.user_id, ctx.timezone)
    start, end = parse_local(args.start, ctx.timezone), parse_local(args.end, ctx.timezone)
    hours = args.working_hours or ctx.app.skills.config("calendar").get("working_hours", "09:00-19:00")
    try:
        a, b = [time.fromisoformat(x.strip()) for x in hours.split("-")]
    except ValueError as exc:
        raise ToolError("working_hours must look like 09:00-19:00") from exc
    events = await cal.list(start, end)
    slots = find_free_slots([(e.start, e.end) for e in events if not e.all_day], start=start, end=end,
                            duration=timedelta(minutes=args.duration_minutes), tz_name=ctx.timezone,
                            day_start=a, day_end=b)
    return {"slots": [{"start": to_local(s, ctx.timezone), "end": to_local(e, ctx.timezone)[11:16]} for s, e in slots]}
