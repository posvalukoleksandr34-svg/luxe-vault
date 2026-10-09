"""Transactional e-mail over SMTP (verification, password reset, invites).

Not configured (no SMTP_HOST) → `configured()` is False and callers say so honestly; nothing is sent and the
links are never written to logs (they are credentials).
"""

from __future__ import annotations

import asyncio
import smtplib
import ssl
from email.message import EmailMessage
from typing import TYPE_CHECKING

from jarvis.core.logging import log

if TYPE_CHECKING:  # pragma: no cover
    from jarvis.core.container import AppContext


class MailError(Exception):
    pass


class Mailer:
    def __init__(self, app: "AppContext"):
        self.app = app

    def configured(self) -> bool:
        s = self.app.settings
        return bool(s.smtp_host and (s.smtp_from or s.smtp_user))

    async def send(self, to: str, subject: str, text: str) -> None:
        if not self.configured():
            raise MailError("e-mail is not configured (SMTP_HOST / SMTP_FROM)")
        s = self.app.settings
        password = await self.app.secrets.get("smtp_password")
        msg = EmailMessage()
        msg["From"] = s.smtp_from or s.smtp_user
        msg["To"] = to
        msg["Subject"] = subject
        msg.set_content(text)

        def _send() -> None:
            ctx = ssl.create_default_context()
            if s.smtp_tls == "ssl":
                server: smtplib.SMTP = smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, context=ctx, timeout=20)
            else:
                server = smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=20)
            with server:
                if s.smtp_tls == "starttls":
                    server.starttls(context=ctx)
                if s.smtp_user and password:
                    server.login(s.smtp_user, password)
                server.send_message(msg)

        try:
            await asyncio.to_thread(_send)
        except Exception as exc:  # noqa: BLE001
            log.warning("mail.failed", subject=subject, error=type(exc).__name__)  # never the body: it has links
            raise MailError(f"could not send e-mail ({type(exc).__name__})") from exc
        log.info("mail.sent", subject=subject)
