"""Telegram and WhatsApp adapters against mocked platform APIs."""

import hashlib
import hmac
import json

import httpx
import pytest
from sqlalchemy import select

from jarvis.channels.telegram import TelegramAdapter
from jarvis.channels.whatsapp import WhatsAppAdapter, verify_signature
from jarvis.db.models import Message, Task
from jarvis.testing import run_tasks

pytestmark = pytest.mark.integration


class FakeTelegram:
    def __init__(self):
        self.sent: list[tuple[str, dict]] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        method = request.url.path.rsplit("/", 1)[-1]
        body = json.loads(request.content or b"{}")
        self.sent.append((method, body))
        if method == "sendMessage":
            return httpx.Response(200, json={"ok": True, "result": {"message_id": len(self.sent)}})
        return httpx.Response(200, json={"ok": True, "result": True})

    def texts(self) -> list[str]:
        return [b.get("text", "") for m, b in self.sent if m == "sendMessage"]


@pytest.fixture
async def telegram(app):
    fake = FakeTelegram()
    adapter = TelegramAdapter(app, transport=httpx.MockTransport(fake.handler))
    original = app.channels.adapters["telegram"]
    app.channels.adapters["telegram"] = adapter
    await app.secrets.set("telegram_bot_token", "123:TEST")
    yield adapter, fake
    app.channels.adapters["telegram"] = original
    await app.secrets.set("telegram_bot_token", None)


def _msg(chat_id: int, text: str) -> dict:
    return {"update_id": 1, "message": {"message_id": 5, "chat": {"id": chat_id, "type": "private"},
                                        "from": {"id": chat_id, "first_name": "Тест"}, "text": text}}


async def test_unlinked_chat_gets_nothing(app, telegram):
    adapter, fake = telegram
    await adapter.handle_update(_msg(111, "покажи мою почту"))
    async with app.sessionmaker() as s:
        assert not (await s.execute(select(Task).where(Task.channel == "telegram",
                                                        Task.input["reply_to"].astext == "111"))).scalars().all()
    assert fake.texts() == ["Этот чат не подключён к JARVIS."]


async def test_pairing_then_reminder_via_telegram(app, user, telegram):
    """Spec §11: «JARVIS, напомни мне завтра в 10 купить X» from Telegram."""
    adapter, fake = telegram
    code = await app.pairing.create_code(user.id, "telegram")
    await adapter.handle_update(_msg(222, f"/start {code}"))
    assert "подключён" in fake.texts()[-1]
    await adapter.handle_update(_msg(222, "JARVIS, напомни мне завтра в 10 купить молоко"))
    await run_tasks(app)
    reminders = await app.automations.list(user.id, kind="reminder")
    r = next(a for a in reminders if "молоко" in a.name.lower())
    local = r.next_run_at.astimezone(__import__("zoneinfo").ZoneInfo(user.timezone))
    assert (local.hour, local.minute) == (10, 0)
    assert any("напомню" in t.lower() for t in fake.texts())
    # same memory/conversation as the web: the message landed in the primary thread
    primary = await app.conversations.primary(user.id)
    async with app.sessionmaker() as s:
        msgs = (await s.execute(select(Message).where(Message.conversation_id == primary.id,
                                                      Message.channel == "telegram"))).scalars().all()
    assert {m.role for m in msgs} >= {"user", "assistant"}


async def test_telegram_inline_button_approves(app, user, telegram, provider):
    from jarvis.llm.fake import ScriptedProvider, text_response, tool_response

    adapter, fake = telegram
    code = await app.pairing.create_code(user.id, "telegram")
    await adapter.handle_update(_msg(333, f"/start {code}"))
    provider.impl = ScriptedProvider([tool_response("automation_create", {"name": "N", "prompt": "p", "cron": "0 8 * * *"}),
                                      text_response("Готово.")])
    await adapter.handle_update(_msg(333, "каждый день в 8 делай обзор"))
    await run_tasks(app)
    approval_msg = next(b for m, b in fake.sent if m == "sendMessage" and "reply_markup" in b)
    data = approval_msg["reply_markup"]["inline_keyboard"][0][0]["callback_data"]
    await adapter.handle_update({"update_id": 9, "callback_query": {
        "id": "cq1", "data": data, "from": {"id": 333}, "message": {"message_id": 7, "chat": {"id": 333}}}})
    await run_tasks(app)
    assert "Готово." in fake.texts()[-1]


def test_whatsapp_signature():
    body = b'{"entry":[]}'
    sig = "sha256=" + hmac.new(b"appsecret", body, hashlib.sha256).hexdigest()
    assert verify_signature("appsecret", body, sig)
    assert not verify_signature("appsecret", body, "sha256=deadbeef")
    assert not verify_signature("appsecret", body, None)


async def test_whatsapp_pairing_and_message(app, user):
    sent = []

    def handler(req: httpx.Request) -> httpx.Response:
        sent.append(json.loads(req.content))
        return httpx.Response(200, json={"messages": [{"id": "wamid.1"}]})

    adapter = WhatsAppAdapter(app, transport=httpx.MockTransport(handler))
    app.settings.whatsapp_phone_number_id = "pn1"
    await app.secrets.set("whatsapp_access_token", "EAAG")
    try:
        code = await app.pairing.create_code(user.id, "whatsapp")
        payload = lambda text: {"entry": [{"changes": [{"value": {  # noqa: E731
            "contacts": [{"wa_id": "4915550001", "profile": {"name": "Тест"}}],
            "messages": [{"from": "4915550001", "id": "m1", "type": "text", "text": {"body": text}}]}}]}]}
        await adapter.handle_payload(payload(f"link {code}"))
        assert "подключён" in sent[-1]["text"]["body"]
        await adapter.handle_payload(payload("запомни, что я люблю тишину по утрам"))
        async with app.sessionmaker() as s:
            t = (await s.execute(select(Task).where(Task.channel == "whatsapp").order_by(Task.created_at.desc())
                                 .limit(1))).scalar_one()
        assert t.input["reply_to"] == "4915550001"
    finally:
        await app.secrets.set("whatsapp_access_token", None)
        app.settings.whatsapp_phone_number_id = None
