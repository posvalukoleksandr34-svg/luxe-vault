"""Request authentication.

- Browser: opaque session token in an httpOnly, SameSite=Lax cookie (Secure behind HTTPS).
  State-changing requests must carry `X-Jarvis-Request: 1` — a header cross-site forms cannot
  set, which (with SameSite) closes CSRF.
- Devices (voice satellite, CLI, scripts): `Authorization: Bearer jv_dev_…` tokens with scopes.
Tokens are stored as SHA-256 only.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import timedelta

from fastapi import Depends, HTTPException, Request, WebSocket
from sqlalchemy import update

from jarvis.core.container import AppContext
from jarvis.db.base import utcnow
from jarvis.db.models import AuthSession, User
from jarvis.security.crypto import token_hash

COOKIE = "jarvis_session"
CSRF_HEADER = "x-jarvis-request"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def get_app(request: Request) -> AppContext:
    return request.app.state.jarvis


@dataclass
class Principal:
    user: User
    session: AuthSession

    @property
    def user_id(self) -> uuid.UUID:
        return self.user.id

    @property
    def elevated(self) -> bool:
        return bool(self.session.elevated_until and self.session.elevated_until > utcnow())

    def has_scope(self, scope: str) -> bool:
        if self.session.kind == "browser":
            return True
        scopes = self.session.scopes or []
        return "*" in scopes or scope in scopes


async def resolve_token(app: AppContext, token: str | None) -> Principal | None:
    if not token:
        return None
    async with app.sessionmaker() as session:
        from sqlalchemy import select

        row = (await session.execute(select(AuthSession).where(AuthSession.token_hash == token_hash(token))))\
            .scalar_one_or_none()
        if row is None or row.revoked_at is not None or (row.expires_at and row.expires_at < utcnow()):
            return None
        user = await session.get(User, row.user_id)
        if user is None:
            return None
        if (utcnow() - row.last_seen_at) > timedelta(minutes=5):
            await session.execute(update(AuthSession).where(AuthSession.id == row.id).values(last_seen_at=utcnow()))
            await session.commit()
        return Principal(user=user, session=row)


def _bearer(value: str | None) -> str | None:
    if value and value.lower().startswith("bearer "):
        return value[7:].strip()
    return None


async def current(request: Request, app: AppContext = Depends(get_app)) -> Principal:
    bearer = _bearer(request.headers.get("authorization"))
    token = bearer or request.cookies.get(COOKIE)
    principal = await resolve_token(app, token)
    if principal is None:
        raise HTTPException(401, "not authenticated")
    if bearer is None and request.method not in SAFE_METHODS and request.headers.get(CSRF_HEADER) != "1":
        raise HTTPException(403, "missing X-Jarvis-Request header")
    return principal


def require_scope(scope: str):
    async def dep(p: Principal = Depends(current)) -> Principal:
        if not p.has_scope(scope):
            raise HTTPException(403, f"token lacks scope {scope}")
        return p

    return dep


def origin_allowed(app: AppContext, origin: str | None) -> bool:
    if origin is None:
        return True  # non-browser clients (satellite) authenticate with bearer tokens
    allowed = {app.settings.public_url.rstrip("/"), "http://localhost:5173", "http://127.0.0.1:5173",
               "http://localhost:8080", "http://127.0.0.1:8080"}
    return origin.rstrip("/") in allowed


async def ws_principal(ws: WebSocket, app: AppContext) -> Principal | None:
    bearer = _bearer(ws.headers.get("authorization")) or ws.query_params.get("token")
    if bearer:
        return await resolve_token(app, bearer)
    if not origin_allowed(app, ws.headers.get("origin")):
        return None
    return await resolve_token(app, ws.cookies.get(COOKIE))
