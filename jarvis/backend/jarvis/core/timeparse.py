"""Date/time helpers shared by tools. The model resolves natural language to ISO 8601;
these helpers attach the user's timezone and validate."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from croniter import croniter
from dateutil import parser as dtparser

from jarvis.tools.base import ToolError


def tz(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except Exception:  # noqa: BLE001
        return ZoneInfo("UTC")


def parse_local(value: str, tz_name: str) -> datetime:
    """Parse ISO-ish datetime; naive values are interpreted in the user's timezone. Returns aware UTC."""
    try:
        dt = dtparser.isoparse(value) if "T" in value or "-" in value else dtparser.parse(value)
    except (ValueError, OverflowError) as exc:
        raise ToolError(f"cannot parse datetime {value!r}; use ISO 8601 like 2026-09-28T10:00") from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=tz(tz_name))
    return dt.astimezone(timezone.utc)


def to_local(dt: datetime, tz_name: str) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(tz(tz_name)).strftime("%Y-%m-%d %H:%M (%a)")


def next_cron(expr: str, tz_name: str, after: datetime | None = None) -> datetime:
    if not croniter.is_valid(expr):
        raise ToolError(f"invalid cron expression {expr!r}; use 5 fields, e.g. '0 9 * * 1' for Mondays 09:00")
    base = (after or datetime.now(timezone.utc)).astimezone(tz(tz_name))
    nxt = croniter(expr, base).get_next(datetime)
    if nxt.tzinfo is None:
        nxt = nxt.replace(tzinfo=tz(tz_name))
    return nxt.astimezone(timezone.utc)


def ensure_future(dt: datetime, *, slack_s: int = 120) -> datetime:
    if dt < datetime.now(timezone.utc) - timedelta(seconds=slack_s):
        raise ToolError("that time is in the past", hint="check the current date in <context> and recompute")
    return dt
