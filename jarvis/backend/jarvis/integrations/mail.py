"""E-mail providers: Gmail when connected, otherwise local drafts (sending needs a real mailbox)."""

from __future__ import annotations

import base64
import re
import uuid
from email.message import EmailMessage
from email.utils import getaddresses
from typing import TYPE_CHECKING, Any

from bs4 import BeautifulSoup
from sqlalchemy import select

from jarvis.db.models import EmailDraft
from jarvis.integrations.google.client import GoogleAPI
from jarvis.tools.base import ToolError

if TYPE_CHECKING:  # pragma: no cover
    from jarvis.core.container import AppContext

GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me"
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def validate_addresses(values: list[str]) -> list[str]:
    out = []
    for _, addr in getaddresses(values):
        if not _EMAIL.match(addr):
            raise ToolError(f"invalid e-mail address: {addr!r}")
        out.append(addr)
    return out


def build_mime(*, to: list[str], subject: str, body: str, cc: list[str] | None = None, sender: str | None = None,
               in_reply_to: str | None = None) -> str:
    msg = EmailMessage()
    msg["To"] = ", ".join(to)
    if cc:
        msg["Cc"] = ", ".join(cc)
    if sender:
        msg["From"] = sender
    msg["Subject"] = subject
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
        msg["References"] = in_reply_to
    msg.set_content(body)
    return base64.urlsafe_b64encode(msg.as_bytes()).decode()


def _decode_part(data: str) -> str:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8", errors="replace")


def extract_body(payload: dict[str, Any]) -> str:
    plain, html = [], []

    def walk(p: dict[str, Any]) -> None:
        mime = p.get("mimeType", "")
        data = (p.get("body") or {}).get("data")
        if data and mime == "text/plain":
            plain.append(_decode_part(data))
        elif data and mime == "text/html":
            html.append(_decode_part(data))
        for part in p.get("parts", []) or []:
            walk(part)

    walk(payload)
    if plain:
        return "\n".join(plain)
    if html:
        return BeautifulSoup("\n".join(html), "html.parser").get_text("\n", strip=True)
    return ""


class Gmail:
    def __init__(self, app: "AppContext", user_id: uuid.UUID):
        self.api = GoogleAPI(app, user_id)

    async def search(self, query: str, limit: int = 10) -> list[dict[str, Any]]:
        data = await self.api.request("GET", f"{GMAIL}/messages", params={"q": query, "maxResults": str(limit)})
        out = []
        for ref in data.get("messages", [])[:limit]:
            m = await self.api.request("GET", f"{GMAIL}/messages/{ref['id']}", params=[
                ("format", "metadata"), ("metadataHeaders", "From"), ("metadataHeaders", "To"),
                ("metadataHeaders", "Subject"), ("metadataHeaders", "Date")])
            headers = {h["name"].lower(): h["value"] for h in m.get("payload", {}).get("headers", [])}
            out.append({"id": m["id"], "thread_id": m.get("threadId"), "from": headers.get("from"),
                        "to": headers.get("to"), "subject": headers.get("subject"), "date": headers.get("date"),
                        "snippet": m.get("snippet"), "unread": "UNREAD" in m.get("labelIds", []),
                        "labels": m.get("labelIds", [])})
        return out

    async def read(self, message_id: str) -> dict[str, Any]:
        m = await self.api.request("GET", f"{GMAIL}/messages/{message_id}", params={"format": "full"})
        headers = {h["name"].lower(): h["value"] for h in m.get("payload", {}).get("headers", [])}
        return {"id": m["id"], "thread_id": m.get("threadId"), "from": headers.get("from"), "to": headers.get("to"),
                "cc": headers.get("cc"), "subject": headers.get("subject"), "date": headers.get("date"),
                "message_id_header": headers.get("message-id"), "body": extract_body(m.get("payload", {}))[:20000]}

    async def create_draft(self, *, to: list[str], subject: str, body: str, cc: list[str] | None = None,
                           in_reply_to: str | None = None, thread_id: str | None = None) -> dict[str, Any]:
        message: dict[str, Any] = {"raw": build_mime(to=to, subject=subject, body=body, cc=cc, in_reply_to=in_reply_to)}
        if thread_id:
            message["threadId"] = thread_id
        d = await self.api.request("POST", f"{GMAIL}/drafts", json={"message": message})
        return {"draft_id": d["id"], "message_id": d.get("message", {}).get("id")}

    async def send_draft(self, draft_id: str) -> dict[str, Any]:
        r = await self.api.request("POST", f"{GMAIL}/drafts/send", json={"id": draft_id})
        return {"message_id": r.get("id"), "thread_id": r.get("threadId")}

    async def modify(self, message_id: str, add: list[str], remove: list[str]) -> dict[str, Any]:
        r = await self.api.request("POST", f"{GMAIL}/messages/{message_id}/modify",
                                   json={"addLabelIds": add, "removeLabelIds": remove})
        return {"id": r.get("id"), "labels": r.get("labelIds", [])}


class LocalDrafts:
    def __init__(self, app: "AppContext", user_id: uuid.UUID):
        self.app, self.user_id = app, user_id

    async def create(self, **fields: Any) -> EmailDraft:
        async with self.app.sessionmaker() as session:
            d = EmailDraft(user_id=self.user_id, **fields)
            session.add(d)
            await session.commit()
            return d

    async def get(self, draft_id: str) -> EmailDraft:
        async with self.app.sessionmaker() as session:
            try:
                d = await session.get(EmailDraft, uuid.UUID(draft_id))
            except ValueError:
                d = None
            if d is None or d.user_id != self.user_id:
                raise ToolError(f"draft {draft_id} not found")
            return d

    async def list(self, limit: int = 20) -> list[EmailDraft]:
        async with self.app.sessionmaker() as session:
            return list((await session.execute(select(EmailDraft).where(EmailDraft.user_id == self.user_id)
                                               .order_by(EmailDraft.created_at.desc()).limit(limit))).scalars())

    async def mark_sent(self, draft_id: str, provider_ref: str | None) -> None:
        async with self.app.sessionmaker() as session:
            d = await session.get(EmailDraft, uuid.UUID(draft_id))
            d.status = "sent"
            d.provider_ref = provider_ref or d.provider_ref
            await session.commit()
