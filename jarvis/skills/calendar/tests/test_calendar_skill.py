from datetime import datetime, time, timedelta, timezone

import pytest

from jarvis.integrations.calendar import find_free_slots


def _utc(h: int, m: int = 0) -> datetime:
    return datetime(2026, 9, 28, h, m, tzinfo=timezone.utc)


def test_free_slots_skip_busy_blocks():
    busy = [(_utc(10), _utc(11)), (_utc(13), _utc(14, 30))]
    slots = find_free_slots(busy, start=_utc(0), end=_utc(23), duration=timedelta(minutes=60), tz_name="UTC",
                            day_start=time(9), day_end=time(18))
    assert slots == [(_utc(9), _utc(10)), (_utc(11), _utc(13)), (_utc(14, 30), _utc(18))]


def test_free_slots_respects_timezone():
    # 09:00-18:00 in Berlin (UTC+2 in September) = 07:00-16:00 UTC
    slots = find_free_slots([], start=_utc(0), end=_utc(23), duration=timedelta(minutes=30), tz_name="Europe/Berlin")
    assert slots[0][0] == _utc(7)


@pytest.mark.integration
async def test_create_and_list_event_local_calendar(app, user, tool_ctx):
    ctx = tool_ctx(user)
    spec = app.registry.get("calendar_create_event")
    out = await app.executor.execute(spec, {"title": "Встреча с Анной", "start": "2031-03-10T15:00"}, ctx)
    assert out.ok, out.error
    assert out.data["calendar"] == "local"
    listed = await app.executor.execute(app.registry.get("calendar_list_events"),
                                        {"start": "2031-03-10T00:00", "end": "2031-03-11T00:00"}, ctx)
    assert listed.data["count"] == 1
    assert listed.data["events"][0]["title"] == "Встреча с Анной"
