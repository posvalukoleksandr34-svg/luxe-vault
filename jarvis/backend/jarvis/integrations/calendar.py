"""Calendar providers behind one interface.

`google` when the user connected Google, otherwise the built-in `local` calendar
(PostgreSQL) — so scheduling works on day one and moves to Google Calendar
transparently once connected.
"""

from __future__ import annotations

import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, time, timedelta, timezone
from typing import TYPE_CHECKING, Any

from sqlalchemy import and_, or_, select

from jarvis.core.timeparse import tz
from jarvis.db.models import CalendarEvent
from jarvis.integrations.google.client import GoogleAPI
from jarvis.tools.base import ToolError

if TYPE_CHECKING:  # pragma: no cover
    from jarvis.core.container import AppContext

GCAL = "https://www.googleapis.com/calendar/v3"


@dataclass
class Event:
    id: str
    title: str
    start: datetime
    end: datetime
    all_day: bool = False
    location: str = ""
    description: str = ""
    attendees: list[str] = field(default_factory=list)
    source: str = "local"
    link: str | None = None

    def as_dict(self, tz_name: str) -> dict[str, Any]:
        d = asdict(self)
        z = tz(tz_name)
        d["start"] = self.start.astimezone(z).isoformat(timespec="minutes")
        d["end"] = self.end.astimezone(z).isoformat(timespec="minutes")
        return d


class CalendarProvider:
    name = "base"

    async def list(self, start: datetime, end: datetime, query: str | None = None) -> list[Event]:  # pragma: no cover
        raise NotImplementedError

    async def create(self, **fields: Any) -> Event:  # pragma: no cover
        raise NotImplementedError

    async def update(self, event_id: str, **fields: Any) -> Event:  # pragma: no cover
        raise NotImplementedError

    async def delete(self, event_id: str) -> None:  # pragma: no cover
        raise NotImplementedError


class LocalCalendar(CalendarProvider):
    name = "local"

    def __init__(self, app: "AppContext", user_id: uuid.UUID):
        self.app, self.user_id = app, user_id

    @staticmethod
    def _to_event(row: CalendarEvent) -> Event:
        return Event(id=str(row.id), title=row.title, start=row.start_at, end=row.end_at, all_day=row.all_day,
                     location=row.location, description=row.description, attendees=list(row.attendees or []))

    async def list(self, start: datetime, end: datetime, query: str | None = None) -> list[Event]:
        async with self.app.sessionmaker() as session:
            stmt = select(CalendarEvent).where(
                CalendarEvent.user_id == self.user_id, CalendarEvent.status != "cancelled",
                and_(CalendarEvent.start_at < end, CalendarEvent.end_at > start))
            if query:
                like = f"%{query}%"
                stmt = stmt.where(or_(CalendarEvent.title.ilike(like), CalendarEvent.description.ilike(like)))
            rows = (await session.execute(stmt.order_by(CalendarEvent.start_at))).scalars()
            return [self._to_event(r) for r in rows]

    async def create(self, *, title: str, start: datetime, end: datetime, description: str = "", location: str = "",
                     attendees: list[str] | None = None, all_day: bool = False) -> Event:
        async with self.app.sessionmaker() as session:
            row = CalendarEvent(user_id=self.user_id, title=title, start_at=start, end_at=end, description=description,
                                location=location, attendees=attendees or [], all_day=all_day)
            session.add(row)
            await session.commit()
            return self._to_event(row)

    async def _get(self, session, event_id: str) -> CalendarEvent:
        try:
            row = await session.get(CalendarEvent, uuid.UUID(event_id))
        except ValueError:
            row = None
        if row is None or row.user_id != self.user_id or row.status == "cancelled":
            raise ToolError(f"event {event_id} not found")
        return row

    async def update(self, event_id: str, **fields: Any) -> Event:
        async with self.app.sessionmaker() as session:
            row = await self._get(session, event_id)
            mapping = {"title": "title", "start": "start_at", "end": "end_at", "description": "description",
                       "location": "location", "attendees": "attendees"}
            for k, v in fields.items():
                if v is not None and k in mapping:
                    setattr(row, mapping[k], v)
            if row.end_at <= row.start_at:
                raise ToolError("event end must be after start")
            await session.commit()
            return self._to_event(row)

    async def delete(self, event_id: str) -> None:
        async with self.app.sessionmaker() as session:
            row = await self._get(session, event_id)
            row.status = "cancelled"
            await session.commit()


def _g_time(value: dict[str, Any], tz_name: str) -> tuple[datetime, bool]:
    if "dateTime" in value:
        return datetime.fromisoformat(value["dateTime"].replace("Z", "+00:00")), False
    d = datetime.fromisoformat(value["date"])
    return d.replace(tzinfo=tz(tz_name)), True


class GoogleCalendar(CalendarProvider):
    name = "google"

    def __init__(self, app: "AppContext", user_id: uuid.UUID, tz_name: str):
        self.api = GoogleAPI(app, user_id)
        self.tz_name = tz_name

    def _to_event(self, item: dict[str, Any]) -> Event:
        start, all_day = _g_time(item["start"], self.tz_name)
        end, _ = _g_time(item["end"], self.tz_name)
        return Event(id=item["id"], title=item.get("summary", "(no title)"), start=start, end=end, all_day=all_day,
                     location=item.get("location", ""), description=(item.get("description") or "")[:1000],
                     attendees=[a.get("email") for a in item.get("attendees", []) if a.get("email")],
                     source="google", link=item.get("htmlLink"))

    async def list(self, start: datetime, end: datetime, query: str | None = None) -> list[Event]:
        params = {"timeMin": start.isoformat(), "timeMax": end.isoformat(), "singleEvents": "true",
                  "orderBy": "startTime", "maxResults": "100"}
        if query:
            params["q"] = query
        data = await self.api.request("GET", f"{GCAL}/calendars/primary/events", params=params)
        return [self._to_event(i) for i in data.get("items", []) if i.get("status") != "cancelled"]

    def _body(self, fields: dict[str, Any]) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if fields.get("title") is not None:
            body["summary"] = fields["title"]
        for key in ("description", "location"):
            if fields.get(key) is not None:
                body[key] = fields[key]
        if fields.get("start") is not None:
            body["start"] = {"dateTime": fields["start"].isoformat(), "timeZone": self.tz_name}
        if fields.get("end") is not None:
            body["end"] = {"dateTime": fields["end"].isoformat(), "timeZone": self.tz_name}
        if fields.get("attendees") is not None:
            body["attendees"] = [{"email": e} for e in fields["attendees"]]
        return body

    async def create(self, **fields: Any) -> Event:
        fields.pop("all_day", None)
        item = await self.api.request("POST", f"{GCAL}/calendars/primary/events", json=self._body(fields),
                                      params={"sendUpdates": "all" if fields.get("attendees") else "none"})
        return self._to_event(item)

    async def update(self, event_id: str, **fields: Any) -> Event:
        item = await self.api.request("PATCH", f"{GCAL}/calendars/primary/events/{event_id}", json=self._body(fields),
                                      params={"sendUpdates": "all" if fields.get("attendees") else "none"})
        return self._to_event(item)

    async def delete(self, event_id: str) -> None:
        await self.api.request("DELETE", f"{GCAL}/calendars/primary/events/{event_id}")


async def get_calendar(app: "AppContext", user_id: uuid.UUID, tz_name: str) -> CalendarProvider:
    if (await app.availability(user_id)).get("google"):
        return GoogleCalendar(app, user_id, tz_name)
    return LocalCalendar(app, user_id)


def find_free_slots(busy: list[tuple[datetime, datetime]], *, start: datetime, end: datetime, duration: timedelta,
                    tz_name: str, day_start: time = time(9, 0), day_end: time = time(19, 0),
                    limit: int = 10) -> list[tuple[datetime, datetime]]:
    """Free windows of at least `duration` inside working hours, earliest first."""
    z = tz(tz_name)
    busy = sorted((b[0].astimezone(timezone.utc), b[1].astimezone(timezone.utc)) for b in busy)
    slots: list[tuple[datetime, datetime]] = []
    day = start.astimezone(z).date()
    last_day = end.astimezone(z).date()
    while day <= last_day and len(slots) < limit:
        win_start = max(datetime.combine(day, day_start, z).astimezone(timezone.utc), start)
        win_end = min(datetime.combine(day, day_end, z).astimezone(timezone.utc), end)
        cursor = win_start
        for b_start, b_end in busy:
            if b_end <= cursor or b_start >= win_end:
                continue
            if b_start - cursor >= duration:
                slots.append((cursor, b_start))
            cursor = max(cursor, b_end)
        if win_end - cursor >= duration:
            slots.append((cursor, win_end))
        day += timedelta(days=1)
    return slots[:limit]
