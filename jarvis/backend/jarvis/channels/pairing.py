"""Secure linking of messenger accounts: the web UI issues a one-time code, the user sends it to the bot."""

from __future__ import annotations

import secrets
import uuid
from datetime import timedelta
from typing import TYPE_CHECKING

from sqlalchemy import select

from jarvis.core.audit import audit
from jarvis.db.base import utcnow
from jarvis.db.models import ChannelLink, PairingCode
from jarvis.security.crypto import token_hash

if TYPE_CHECKING:  # pragma: no cover
    from jarvis.core.container import AppContext


class PairingService:
    def __init__(self, app: "AppContext"):
        self.app = app

    async def create_code(self, user_id: uuid.UUID, channel: str, ttl_minutes: int = 10) -> str:
        code = f"{secrets.randbelow(10**6):06d}"
        async with self.app.sessionmaker() as session:
            session.add(PairingCode(user_id=user_id, channel=channel, code_hash=token_hash(f"{channel}:{code}"),
                                    expires_at=utcnow() + timedelta(minutes=ttl_minutes)))
            await session.commit()
        return code

    async def redeem(self, channel: str, code: str, external_id: str, display: str = "") -> ChannelLink | None:
        code = "".join(ch for ch in code if ch.isdigit())
        if len(code) != 6:
            return None
        if not await self.app.ratelimiter.hit(f"pair:{channel}:{external_id}", limit=5, window_s=600):
            return None
        async with self.app.sessionmaker() as session:
            row = (await session.execute(select(PairingCode).where(
                PairingCode.code_hash == token_hash(f"{channel}:{code}"), PairingCode.used_at.is_(None),
                PairingCode.expires_at > utcnow()))).scalar_one_or_none()
            if row is None:
                return None
            row.used_at = utcnow()
            link = (await session.execute(select(ChannelLink).where(
                ChannelLink.channel == channel, ChannelLink.external_id == external_id))).scalar_one_or_none()
            if link is None:
                link = ChannelLink(user_id=row.user_id, channel=channel, external_id=external_id, display=display)
                session.add(link)
            link.user_id = row.user_id
            link.display = display or link.display
            link.verified_at = utcnow()
            await audit(session, action="channel.linked", actor=f"channel:{channel}", user_id=row.user_id,
                        target=channel, data={"external_id": external_id, "display": display})
            await session.commit()
            return link

    async def resolve(self, channel: str, external_id: str) -> ChannelLink | None:
        async with self.app.sessionmaker() as session:
            return (await session.execute(select(ChannelLink).where(
                ChannelLink.channel == channel, ChannelLink.external_id == external_id,
                ChannelLink.verified_at.is_not(None)))).scalar_one_or_none()
