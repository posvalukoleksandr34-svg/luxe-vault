from datetime import timedelta

import pytest
from sqlalchemy import select

from jarvis.db.base import utcnow
from jarvis.db.models import Automation, Message, Notification, Task
from jarvis.tasks.scheduler import compute_next
from jarvis.testing import run_tasks

pytestmark = pytest.mark.integration


async def test_claim_is_exclusive_and_expired_leases_are_recovered(app, user):
    t = await app.tasks.create(user_id=user.id, kind="memory_extract", input={"user_text": "", "assistant_text": ""})
    a = await app.tasks.claim("w1", limit=10)
    b = await app.tasks.claim("w2", limit=10)
    assert t.id in {x.id for x in a} and t.id not in {x.id for x in b}
    async with app.sessionmaker() as s:
        row = await s.get(Task, t.id)
        row.lease_expires_at = utcnow() - timedelta(seconds=1)  # w1 died
        await s.commit()
    c = await app.tasks.claim("w3", limit=10)
    assert t.id in {x.id for x in c}
    await app.tasks.complete(t.id, {})


async def test_retryable_failures_back_off_then_fail(app, user):
    t = await app.tasks.create(user_id=user.id, kind="background", input={}, max_attempts=2)
    await app.tasks.claim("w", limit=10)
    retried = await app.tasks.fail(t.id, "rate limited", retryable=True)
    assert retried.status == "queued" and retried.run_after > utcnow()
    async with app.sessionmaker() as s:
        row = await s.get(Task, t.id)
        row.run_after = utcnow()
        await s.commit()
    await app.tasks.claim("w", limit=10)
    final = await app.tasks.fail(t.id, "rate limited", retryable=True)
    assert final.status == "failed"


async def test_reminder_fires_delivers_and_disables(app, user):
    a = await app.automations.create(user_id=user.id, name="Позвонить маме", kind="reminder", schedule_type="once",
                                     run_at=utcnow() + timedelta(hours=1), timezone_name="Europe/Berlin",
                                     payload={"message": "Позвонить маме"})
    assert await app.automations.tick() == 0  # not due yet
    async with app.sessionmaker() as s:
        row = await s.get(Automation, a.id)
        row.next_run_at = utcnow() - timedelta(seconds=5)
        await s.commit()
    assert await app.automations.tick() == 1
    await run_tasks(app)
    async with app.sessionmaker() as s:
        row = await s.get(Automation, a.id)
        assert row.enabled is False and row.run_count == 1 and row.last_status == "delivered"
        note = (await s.execute(select(Notification).where(Notification.user_id == user.id,
                                                           Notification.source == "reminder"))).scalars().all()
        assert any("Позвонить маме" in n.title for n in note)
        notice = (await s.execute(select(Message).where(Message.role == "notice",
                                                        Message.content.like("%Позвонить маме%")))).scalars().all()
        assert notice


async def test_agent_automation_runs_prompt_and_notifies(app, user):
    a = await app.automations.create(user_id=user.id, name="Утренний брифинг", kind="agent", schedule_type="cron",
                                     cron="30 7 * * 1-5", timezone_name="Europe/Berlin",
                                     payload={"prompt": "что у меня завтра в календаре?"})
    assert a.next_run_at.astimezone().minute == 30
    async with app.sessionmaker() as s:
        row = await s.get(Automation, a.id)
        row.next_run_at = utcnow() - timedelta(seconds=1)
        await s.commit()
    await app.automations.tick()
    await run_tasks(app)
    async with app.sessionmaker() as s:
        row = await s.get(Automation, a.id)
        assert row.enabled and row.next_run_at > utcnow() and row.last_status == "done"
        n = (await s.execute(select(Notification).where(Notification.source == "automation",
                                                        Notification.user_id == user.id))).scalars().all()
        assert n and "Утренний брифинг" in n[-1].title


def test_compute_next_interval_and_cron():
    a = Automation(schedule_type="interval", interval_seconds=3600, timezone="UTC", created_at=utcnow(), run_count=0)
    assert timedelta(minutes=59) < compute_next(a) - utcnow() <= timedelta(hours=1)
    c = Automation(schedule_type="cron", cron="0 9 * * 5", timezone="Europe/Kyiv", run_count=0)
    nxt = compute_next(c)
    assert nxt.weekday() == 4 or nxt.astimezone().weekday() in (3, 4)
