import base64
import email

import pytest

from jarvis.integrations.mail import build_mime, extract_body, validate_addresses
from jarvis.tools.base import ToolError


def test_build_mime_roundtrip():
    raw = build_mime(to=["anna@example.com"], subject="Привет", body="Текст письма", cc=["bob@example.com"])
    msg = email.message_from_bytes(base64.urlsafe_b64decode(raw))
    assert msg["To"] == "anna@example.com"
    assert msg["Cc"] == "bob@example.com"
    assert "Текст письма" in msg.get_payload(decode=True).decode()


def test_extract_body_prefers_plain_text():
    enc = lambda s: base64.urlsafe_b64encode(s.encode()).decode()  # noqa: E731
    payload = {"mimeType": "multipart/alternative", "parts": [
        {"mimeType": "text/html", "body": {"data": enc("<p>HTML</p>")}},
        {"mimeType": "text/plain", "body": {"data": enc("plain")}},
    ]}
    assert extract_body(payload) == "plain"


def test_validate_addresses_rejects_garbage():
    assert validate_addresses(["Anna <anna@example.com>"]) == ["anna@example.com"]
    with pytest.raises(ToolError):
        validate_addresses(["not-an-email"])


@pytest.mark.integration
async def test_local_draft_and_send_requires_mailbox(app, user, tool_ctx):
    ctx = tool_ctx(user)
    out = await app.executor.execute(app.registry.get("email_create_draft"),
                                     {"to": ["Anna"], "subject": "Встреча", "body": "Привет!"}, ctx)
    assert out.ok and out.data["draft"]["provider"] == "local"
    sent = await app.executor.execute(app.registry.get("email_send_draft"), {"draft_id": out.data["draft"]["id"]}, ctx)
    assert not sent.ok and "cannot be sent" in sent.error
