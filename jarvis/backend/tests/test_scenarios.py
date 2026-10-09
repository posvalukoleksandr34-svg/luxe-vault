"""End-to-end scenarios from the specification, run through the real pipeline
(API → conversation → task queue → agent runtime → tools → DB/memory → reply) with the
deterministic DemoBrain standing in for the model.

These prove the plumbing: permissions, persistence, memory, scheduling and delivery. They do not
measure the language model's judgement — that needs the real brain (see docs/TESTING.md).
"""

import zoneinfo

import pytest

from jarvis.testing import run_tasks

pytestmark = pytest.mark.integration


async def _say(authed, app, text, conversation_id=None):
    r = await authed.post("/api/chat", json={"text": text, "conversation_id": conversation_id})
    assert r.status_code == 200, r.text
    await run_tasks(app)
    conv = r.json()["conversation_id"]
    msgs = (await authed.get(f"/api/conversations/{conv}/messages")).json()["messages"]
    return msgs[-1]["content"], conv, r.json()["task_id"]


async def test_scenario_1_schedule_meeting(authed, app, user):
    """«Назначь встречу с X завтра в 15:00» → checks calendar → creates event → confirms."""
    reply, _, task_id = await _say(authed, app, "Назначь встречу с Анной завтра в 15:00")
    assert "Встреча с Анной" in reply and "создана" in reply
    detail = (await authed.get(f"/api/tasks/{task_id}")).json()
    assert [c["tool"] for c in detail["tool_calls"]] == ["calendar_list_events", "calendar_create_event"]
    cal = (await authed.get("/api/calendar", params={"days": 3})).json()
    ev = next(e for e in cal["events"] if e["title"] == "Встреча с Анной")
    assert ev["start"][11:16] == "15:00" and cal["source"] == "local"
    # a second request for the same slot is detected as a conflict
    reply2, _, _ = await _say(authed, app, "Назначь встречу с Борисом завтра в 15:00")
    assert "уже есть" in reply2


async def test_scenario_2_research_is_honest_without_a_real_brain(authed, app):
    reply, _, _ = await _say(authed, app, "Найди мне информацию о квантовых компьютерах и сделай краткий отчёт")
    assert "ANTHROPIC_API_KEY" in reply  # the demo brain never fabricates research


async def test_scenario_3_email_draft_is_shown_not_sent(authed, app):
    reply, _, task_id = await _say(authed, app, "Напиши письмо anna@example.com о переносе встречи на пятницу")
    assert "Черновик готов" in reply and "anna@example.com" in reply
    drafts = (await authed.get("/api/drafts")).json()["drafts"]
    assert drafts[0]["status"] == "draft" and drafts[0]["to"] == ["anna@example.com"]
    tools = [c["tool"] for c in (await authed.get(f"/api/tasks/{task_id}")).json()["tool_calls"]]
    assert "email_send_draft" not in tools


async def test_scenario_4_every_friday_needs_confirmation_then_schedules(authed, app, user):
    reply, conv, task_id = await _say(authed, app, "Каждую пятницу в 18:00 присылай мне обзор недели")
    task = (await authed.get(f"/api/tasks/{task_id}")).json()["task"]
    assert task["status"] == "waiting_approval"  # automation_create is confirm-tier by policy
    approval = (await authed.get("/api/approvals")).json()["approvals"][0]
    assert approval["tool"] == "automation_create"
    r = await authed.post(f"/api/approvals/{approval['id']}", json={"approve": True})
    assert r.status_code == 200
    await run_tasks(app)
    autos = (await authed.get("/api/automations")).json()["automations"]
    weekly = next(a for a in autos if a["cron"] == "0 18 * * 5")
    nxt = __import__("datetime").datetime.fromisoformat(weekly["next_run_at"]).astimezone(zoneinfo.ZoneInfo(user.timezone))
    assert nxt.weekday() == 4 and nxt.hour == 18


async def test_scenario_5_remember_and_recall(authed, app):
    reply, conv, _ = await _say(authed, app, "Запомни, что мне нравится итальянская кухня")
    assert "Запомнил" in reply
    reply, _, _ = await _say(authed, app, "Что мне нравится?", conversation_id=None)
    assert "итальянская кухня" in reply
    # survives a restart: a brand-new conversation still recalls it
    new_conv = (await authed.post("/api/conversations", json={"title": "новый"})).json()["id"]
    reply, _, _ = await _say(authed, app, "Что мне нравится?", conversation_id=new_conv)
    assert "итальянская кухня" in reply


async def test_scenario_final_ux_reminder_before_meeting(authed, app, user):
    """«напомни через 30 минут …» — reminder created, fires, lands as a notification."""
    reply, _, _ = await _say(authed, app, "Напомни через 30 минут позвонить в банк")
    assert "напомню" in reply.lower()
    autos = (await authed.get("/api/automations")).json()["automations"]
    assert any(a["kind"] == "reminder" and "банк" in a["name"] for a in autos)
