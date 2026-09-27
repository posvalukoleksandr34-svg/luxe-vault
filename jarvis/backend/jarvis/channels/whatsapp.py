"""WhatsApp channel via the official WhatsApp Business Cloud API (Meta Graph API).

Requires a Meta developer app with the WhatsApp product, a business phone
number (test number works), a permanent access token, the app secret (to
verify webhook signatures) and a verify token of your choice.

Constraints of the platform: free-form messages may only be sent within 24 h
after the user's last message (the "customer service window"). Proactive
reminders outside that window need an approved message template — JARVIS falls
back to other channels when a send is rejected.
"""

from __future__ import annotations

import hashlib
import hmac
import uuid
from typing import TYPE_CHECKING, Any

import httpx

from jarvis.channels.hub import ChannelAdapter, approval_text, split_text
from jarvis.core.logging import log
from jarvis.db.models import Approval
from jarvis.permissions.approvals import ApprovalError

if TYPE_CHECKING:  # pragma: no cover
    from jarvis.core.container import AppContext

GRAPH = "https://graph.facebook.com"


def verify_signature(app_secret: str, body: bytes, header: str | None) -> bool:
    if not header or not header.startswith("sha256="):
        return False
    expected = hmac.new(app_secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header.split("=", 1)[1])


class WhatsAppAdapter(ChannelAdapter):
    name = "whatsapp"

    def __init__(self, app: "AppContext", transport: httpx.AsyncBaseTransport | None = None):
        super().__init__(app)
        self.transport = transport

    async def available(self) -> bool:
        return bool(await self.app.secrets.get("whatsapp_access_token") and self.app.settings.whatsapp_phone_number_id)

    async def _post(self, payload: dict[str, Any]) -> dict[str, Any]:
        token = await self.app.secrets.get("whatsapp_access_token")
        s = self.app.settings
        async with httpx.AsyncClient(timeout=30, transport=self.transport) as client:
            r = await client.post(f"{GRAPH}/{s.whatsapp_graph_version}/{s.whatsapp_phone_number_id}/messages",
                                  json={"messaging_product": "whatsapp", **payload},
                                  headers={"Authorization": f"Bearer {token}"})
        if r.status_code >= 400:
            raise RuntimeError(f"whatsapp send failed {r.status_code}: {r.text[:300]}")
        return r.json()

    async def send_text(self, external_id: str, text: str) -> None:
        for chunk in split_text(text or "…", 4000):
            await self._post({"to": external_id, "type": "text", "text": {"body": chunk, "preview_url": False}})

    async def send_approval(self, external_id: str, approval: Approval, *, web_only: bool) -> None:
        body = approval_text(approval, web_only=web_only, public_url=self.app.settings.public_url)[:1000]
        if web_only:
            await self.send_text(external_id, body)
            return
        await self._post({"to": external_id, "type": "interactive", "interactive": {
            "type": "button", "body": {"text": body},
            "action": {"buttons": [
                {"type": "reply", "reply": {"id": f"ap:y:{approval.id}", "title": "Подтвердить"}},
                {"type": "reply", "reply": {"id": f"ap:n:{approval.id}", "title": "Отклонить"}},
            ]}}})

    async def _download_media(self, media_id: str) -> tuple[bytes, str]:
        token = await self.app.secrets.get("whatsapp_access_token")
        headers = {"Authorization": f"Bearer {token}"}
        async with httpx.AsyncClient(timeout=60, transport=self.transport) as client:
            meta = (await client.get(f"{GRAPH}/{self.app.settings.whatsapp_graph_version}/{media_id}", headers=headers)).json()
            r = await client.get(meta["url"], headers=headers)
            r.raise_for_status()
            return r.content, meta.get("mime_type", "audio/ogg")

    async def handle_payload(self, payload: dict[str, Any]) -> None:
        for entry in payload.get("entry", []):
            for change in entry.get("changes", []):
                value = change.get("value") or {}
                contacts = {c.get("wa_id"): (c.get("profile") or {}).get("name", "") for c in value.get("contacts", [])}
                for msg in value.get("messages", []):
                    try:
                        await self._on_message(msg, contacts.get(msg.get("from"), ""))
                    except Exception:  # noqa: BLE001
                        log.exception("whatsapp.message_failed")

    async def _on_message(self, msg: dict[str, Any], display: str) -> None:
        wa_id = msg.get("from")
        mtype = msg.get("type")
        text = ""
        if mtype == "text":
            text = (msg.get("text") or {}).get("body", "").strip()
        if text.lower().startswith(("link ", "/link ", "код ", "/start ")):
            link = await self.app.pairing.redeem("whatsapp", text.split(maxsplit=1)[1], wa_id, display)
            await self.send_text(wa_id, "✅ WhatsApp подключён к JARVIS." if link else "Код неверный или истёк.")
            return
        link = await self.app.pairing.resolve("whatsapp", wa_id)
        if link is None:
            if await self.app.ratelimiter.hit(f"wa:unlinked:{wa_id}", limit=2, window_s=3600):
                await self.send_text(wa_id, "Этот номер не подключён. Отправьте: link <код из JARVIS → Integrations>.")
            return
        if mtype == "interactive":
            reply = (msg.get("interactive") or {}).get("button_reply") or {}
            rid = reply.get("id", "")
            if rid.startswith("ap:"):
                _, verdict, approval_id = rid.split(":", 2)
                try:
                    a = await self.app.approvals.decide(uuid.UUID(approval_id), user_id=link.user_id,
                                                        approve=verdict == "y", via="whatsapp")
                    await self.send_text(wa_id, "Подтверждено ✅" if a.status == "approved" else "Отклонено ❌")
                except ApprovalError as exc:
                    await self.send_text(wa_id, str(exc))
            return
        if mtype == "audio":
            audio, mime = await self._download_media((msg.get("audio") or {}).get("id"))
            text = await self.app.voice.transcribe(audio, mime)
        if not text:
            await self.send_text(wa_id, "Пока я понимаю текст и голосовые сообщения.")
            return
        await self.app.conversations.submit(user_id=link.user_id, text=text, channel="whatsapp", reply_to=wa_id,
                                            meta={"whatsapp_message_id": msg.get("id")})
