"""Telegram channel (Bot API over HTTPS).

- Webhook mode (production): Telegram POSTs to /api/webhooks/telegram with the
  X-Telegram-Bot-Api-Secret-Token header we registered.
- Polling mode (development, no public URL): the worker long-polls getUpdates;
  a Redis lock guarantees a single poller.
- Linking: the user sends `/start <code>` (or `/link <code>`) with a code from
  Integrations → Telegram. Unlinked chats get no access to anything.
- Text and voice notes (transcribed by the STT provider) become agent turns in
  the user's primary conversation; approvals arrive as inline buttons.
"""

from __future__ import annotations

import asyncio
import contextlib
import uuid
from typing import TYPE_CHECKING, Any

import httpx

from jarvis.billing.service import QuotaExceeded
from jarvis.channels.hub import ChannelAdapter, approval_text, split_text
from jarvis.core.logging import log
from jarvis.db.models import Approval
from jarvis.permissions.approvals import ApprovalError

if TYPE_CHECKING:  # pragma: no cover
    from jarvis.core.container import AppContext

API = "https://api.telegram.org"
POLL_LOCK = "jarvis:telegram:poller"


class TelegramAdapter(ChannelAdapter):
    name = "telegram"

    def __init__(self, app: "AppContext", transport: httpx.AsyncBaseTransport | None = None):
        super().__init__(app)
        self.transport = transport

    async def token(self) -> str | None:
        return await self.app.secrets.get("telegram_bot_token")

    async def available(self) -> bool:
        return bool(await self.token()) and self.app.settings.telegram_mode != "off"

    async def call(self, method: str, **payload: Any) -> Any:
        token = await self.token()
        if not token:
            raise RuntimeError("telegram bot token not configured")
        async with httpx.AsyncClient(timeout=70, transport=self.transport) as client:
            r = await client.post(f"{API}/bot{token}/{method}", json=payload)
        data = r.json()
        if not data.get("ok"):
            raise RuntimeError(f"telegram {method} failed: {data.get('description')}")
        return data.get("result")

    async def send_text(self, external_id: str, text: str) -> None:
        for chunk in split_text(text or "…", 4000):
            await self.call("sendMessage", chat_id=int(external_id), text=chunk, disable_web_page_preview=True)

    async def send_approval(self, external_id: str, approval: Approval, *, web_only: bool) -> None:
        payload: dict[str, Any] = {
            "chat_id": int(external_id),
            "text": approval_text(approval, web_only=web_only, public_url=self.app.settings.public_url),
        }
        if not web_only:
            payload["reply_markup"] = {"inline_keyboard": [[
                {"text": "✅ Подтвердить", "callback_data": f"ap:y:{approval.id}"},
                {"text": "❌ Отклонить", "callback_data": f"ap:n:{approval.id}"},
            ]]}
        await self.call("sendMessage", **payload)

    # ------------------------------------------------------------------ inbound

    async def handle_update(self, update: dict[str, Any]) -> None:
        if "callback_query" in update:
            await self._on_callback(update["callback_query"])
            return
        msg = update.get("message") or update.get("edited_message")
        if not msg or msg.get("chat", {}).get("type") != "private":
            return  # groups are ignored: JARVIS is a personal assistant
        chat_id = str(msg["chat"]["id"])
        sender = msg.get("from") or {}
        display = " ".join(x for x in (sender.get("first_name"), sender.get("last_name")) if x) or sender.get("username", "")
        text = (msg.get("text") or msg.get("caption") or "").strip()

        if text.startswith(("/start", "/link")):
            parts = text.split(maxsplit=1)
            if len(parts) == 2:
                link = await self.app.pairing.redeem("telegram", parts[1], chat_id, display)
                await self.send_text(chat_id, "✅ Telegram подключён к JARVIS. Пишите — я на связи." if link
                                     else "Код неверный или истёк. Получите новый в JARVIS → Integrations → Telegram.")
            else:
                await self.send_text(chat_id, "Это личный JARVIS. Чтобы подключиться, отправьте /start <код> — код "
                                              "выдаётся в веб-интерфейсе: Integrations → Telegram.")
            return

        link = await self.app.pairing.resolve("telegram", chat_id)
        if link is None:
            if await self.app.ratelimiter.hit(f"tg:unlinked:{chat_id}", limit=3, window_s=3600):
                await self.send_text(chat_id, "Этот чат не подключён к JARVIS.")
            return

        if msg.get("voice") or msg.get("audio"):
            media = msg.get("voice") or msg.get("audio")
            with contextlib.suppress(Exception):
                await self.call("sendChatAction", chat_id=int(chat_id), action="typing")
            try:
                audio = await self._download(media["file_id"])
                text = await self.app.voice.transcribe(audio, media.get("mime_type") or "audio/ogg")
            except Exception as exc:  # noqa: BLE001
                log.warning("telegram.voice_failed", error=str(exc))
                await self.send_text(chat_id, "Не удалось распознать голосовое сообщение.")
                return
            if not text:
                await self.send_text(chat_id, "Не расслышал, повторите, пожалуйста.")
                return

        if not text:
            await self.send_text(chat_id, "Пока я понимаю текст и голосовые сообщения.")
            return
        with contextlib.suppress(Exception):
            await self.call("sendChatAction", chat_id=int(chat_id), action="typing")
        try:
            await self.app.conversations.submit(user_id=link.user_id, text=text, channel="telegram", reply_to=chat_id,
                                                meta={"telegram_message_id": msg.get("message_id")})
        except QuotaExceeded as exc:
            await self.send_text(chat_id, str(exc))

    async def _on_callback(self, cq: dict[str, Any]) -> None:
        data = cq.get("data") or ""
        chat_id = str((cq.get("message") or {}).get("chat", {}).get("id") or cq.get("from", {}).get("id"))
        answer = "Готово"
        link = await self.app.pairing.resolve("telegram", chat_id)
        if link is not None and data.startswith("ap:"):
            _, verdict, approval_id = data.split(":", 2)
            try:
                a = await self.app.approvals.decide(uuid.UUID(approval_id), user_id=link.user_id,
                                                    approve=verdict == "y", via="telegram")
                answer = "Подтверждено ✅" if a.status == "approved" else "Отклонено ❌"
            except ApprovalError as exc:
                answer = str(exc)[:190]
            except ValueError:
                answer = "Некорректный запрос"
            with contextlib.suppress(Exception):
                msg = cq.get("message") or {}
                await self.call("editMessageReplyMarkup", chat_id=int(chat_id), message_id=msg.get("message_id"),
                                reply_markup={"inline_keyboard": []})
        with contextlib.suppress(Exception):
            await self.call("answerCallbackQuery", callback_query_id=cq["id"], text=answer)

    async def _download(self, file_id: str) -> bytes:
        info = await self.call("getFile", file_id=file_id)
        token = await self.token()
        async with httpx.AsyncClient(timeout=60, transport=self.transport) as client:
            r = await client.get(f"{API}/file/bot{token}/{info['file_path']}")
            r.raise_for_status()
            if len(r.content) > 20 * 1024 * 1024:
                raise ValueError("voice message too large")
            return r.content

    # ------------------------------------------------------------------ transport modes

    async def set_webhook(self) -> None:
        secret = self.app.settings.telegram_webhook_secret
        await self.call("setWebhook", url=f"{self.app.settings.public_url}/api/webhooks/telegram",
                        secret_token=secret, allowed_updates=["message", "callback_query"], drop_pending_updates=False)

    async def poll_forever(self, stop: asyncio.Event) -> None:
        """Long-poll getUpdates. Only one process polls (Redis lock)."""
        redis = self.app.redis
        me = f"{self.app.worker_id}"
        offset = None
        webhook_cleared = False
        while not stop.is_set():
            if not await self.available():
                await _sleep(stop, 30)
                continue
            if redis is not None:
                got = await redis.set(POLL_LOCK, me, nx=True, ex=90)
                if not got and (await redis.get(POLL_LOCK)) not in (me, me.encode()):
                    await _sleep(stop, 30)
                    continue
                await redis.expire(POLL_LOCK, 90)
            try:
                if not webhook_cleared:
                    await self.call("deleteWebhook", drop_pending_updates=False)
                    webhook_cleared = True
                updates = await self.call("getUpdates", timeout=50, offset=offset,
                                          allowed_updates=["message", "callback_query"])
                for upd in updates or []:
                    offset = upd["update_id"] + 1
                    try:
                        await self.handle_update(upd)
                    except Exception:  # noqa: BLE001
                        log.exception("telegram.update_failed")
            except Exception as exc:  # noqa: BLE001
                log.warning("telegram.poll_error", error=str(exc))
                await _sleep(stop, 10)


async def _sleep(stop: asyncio.Event, seconds: float) -> None:
    with contextlib.suppress(asyncio.TimeoutError):
        await asyncio.wait_for(stop.wait(), timeout=seconds)
