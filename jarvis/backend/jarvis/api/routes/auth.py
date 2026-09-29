from __future__ import annotations

from typing import Literal

import secrets
import uuid
from datetime import timedelta
from pathlib import Path

import pyotp
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from jarvis.api.deps import COOKIE, Principal, current, get_app
from jarvis.core.audit import audit
from jarvis.core.container import AppContext
from jarvis.core.mailer import Mailer
from jarvis.db.base import utcnow
from jarvis.db.models import AuthSession, User
from jarvis.security.crypto import constant_time_equals, new_token, token_hash
from jarvis.security.passwords import hash_password, needs_rehash, verify_password

EMAIL = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"

router = APIRouter(prefix="/api/auth", tags=["auth"])


def setup_code_path(app: AppContext) -> Path:
    return app.settings.secrets_dir / "setup_code"


async def ensure_setup_code(app: AppContext) -> str | None:
    """Printed to the API log on first boot; required to create the owner account from the web."""
    async with app.sessionmaker() as session:
        users = (await session.execute(select(func.count()).select_from(User))).scalar_one()
    path = setup_code_path(app)
    if users:
        path.unlink(missing_ok=True)
        return None
    if path.exists():
        return path.read_text().strip()
    code = secrets.token_hex(4).upper()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(code)
    path.chmod(0o600)
    return code


async def create_user(app: AppContext, *, email: str, password: str, name: str, timezone: str, owner: bool,
                      verified: bool | None = None) -> User:
    async with app.sessionmaker() as session:
        user = User(email=email.lower(), display_name=name, password_hash=hash_password(password), is_owner=owner,
                    timezone=timezone, locale=app.settings.locale,
                    settings={"notify_channels": ["web", "telegram", "whatsapp"]},
                    # the owner and accounts the owner creates are trusted; self sign-ups verify by e-mail
                    email_verified_at=utcnow() if (owner if verified is None else verified) else None,
                    onboarded_at=utcnow() if owner else None)
        session.add(user)
        await session.flush()
        await audit(session, action="user.created", actor="system", user_id=user.id, target=user.email)
        await session.commit()
        return user


def _set_cookie(response: Response, app: AppContext, token: str) -> None:
    response.set_cookie(COOKIE, token, httponly=True, secure=app.settings.secure_cookies, samesite="lax",
                        max_age=app.settings.session_ttl_days * 86400, path="/")


async def _issue(app: AppContext, request: Request, user: User, *, kind: str = "browser", name: str = "",
                 scopes: list[str] | None = None, ttl_days: int | None = None) -> str:
    token = new_token("jv_dev" if kind == "device" else "jv_s")
    ttl = ttl_days if ttl_days is not None else app.settings.session_ttl_days
    async with app.sessionmaker() as session:
        session.add(AuthSession(
            user_id=user.id, token_hash=token_hash(token), kind=kind, name=name or kind,
            scopes=scopes or [], user_agent=(request.headers.get("user-agent") or "")[:300],
            ip=request.client.host if request.client else None,
            expires_at=utcnow() + timedelta(days=ttl) if ttl else None))
        await audit(session, action=f"auth.{kind}_session_created", actor="user", user_id=user.id,
                    data={"name": name, "ip": request.client.host if request.client else None})
        await session.commit()
    return token


class SetupIn(BaseModel):
    setup_code: str
    email: str = Field(pattern=EMAIL, max_length=320)
    password: str = Field(min_length=10)
    name: str = "Owner"
    timezone: str = "UTC"


@router.get("/setup")
async def setup_status(app: AppContext = Depends(get_app)) -> dict:
    async with app.sessionmaker() as session:
        users = (await session.execute(select(func.count()).select_from(User))).scalar_one()
    return {"needs_setup": users == 0}


@router.post("/setup")
async def setup(body: SetupIn, request: Request, response: Response, app: AppContext = Depends(get_app)) -> dict:
    code = await ensure_setup_code(app)
    if code is None:
        raise HTTPException(409, "already set up")
    if not await app.ratelimiter.hit(f"setup:{request.client.host if request.client else '-'}", limit=10, window_s=600):
        raise HTTPException(429, "too many attempts")
    if not constant_time_equals(body.setup_code.strip().upper(), code):
        raise HTTPException(403, "invalid setup code (see `docker compose logs api | grep SETUP`)")
    user = await create_user(app, email=body.email, password=body.password, name=body.name,
                             timezone=body.timezone, owner=True)
    setup_code_path(app).unlink(missing_ok=True)
    _set_cookie(response, app, await _issue(app, request, user))
    return {"ok": True, "user": user_payload(user)}


class LoginIn(BaseModel):
    email: str = Field(pattern=EMAIL, max_length=320)
    password: str
    totp: str | None = None


@router.post("/login")
async def login(body: LoginIn, request: Request, response: Response, app: AppContext = Depends(get_app)) -> dict:
    ip = request.client.host if request.client else "-"
    if not await app.ratelimiter.hit(f"login:{ip}", limit=10, window_s=300):
        raise HTTPException(429, "too many attempts, try again in a few minutes")
    async with app.sessionmaker() as session:
        user = (await session.execute(select(User).where(User.email == body.email.lower()))).scalar_one_or_none()
        if user is not None and user.locked_until and user.locked_until > utcnow():
            raise HTTPException(423, "account temporarily locked after failed attempts")
        ok = user is not None and verify_password(user.password_hash, body.password)
        if ok and user.totp_enabled:
            secret = app.box.decrypt(user.totp_secret_enc) if user.totp_secret_enc else ""
            if not body.totp:
                raise HTTPException(401, "totp_required")
            ok = pyotp.TOTP(secret).verify(body.totp.strip(), valid_window=1)
        if not ok:
            if user is not None:
                user.failed_logins += 1
                if user.failed_logins >= 8:
                    user.locked_until = utcnow() + timedelta(minutes=15)
                    user.failed_logins = 0
                await audit(session, action="auth.login_failed", actor="user", user_id=user.id, data={"ip": ip})
                await session.commit()
            raise HTTPException(401, "invalid credentials")
        if not user.is_owner and user.email_verified_at is None and Mailer(app).configured():
            raise HTTPException(403, {"code": "email_not_verified",
                                      "message": "confirm your e-mail first (check your inbox)"})
        user.failed_logins = 0
        if needs_rehash(user.password_hash):
            user.password_hash = hash_password(body.password)
        await session.commit()
    _set_cookie(response, app, await _issue(app, request, user))
    return {"ok": True, "user": user_payload(user)}


@router.post("/logout")
async def logout(response: Response, p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    async with app.sessionmaker() as session:
        row = await session.get(AuthSession, p.session.id)
        row.revoked_at = utcnow()
        await session.commit()
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


def user_payload(u: User) -> dict:
    return {"id": str(u.id), "email": u.email, "display_name": u.display_name, "timezone": u.timezone,
            "locale": u.locale, "is_owner": u.is_owner, "totp_enabled": u.totp_enabled, "settings": u.settings or {}}


@router.get("/me")
async def me(p: Principal = Depends(current)) -> dict:
    return {"user": user_payload(p.user), "session": {"id": str(p.session.id), "kind": p.session.kind,
                                                      "elevated": p.elevated}}


class ElevateIn(BaseModel):
    password: str | None = None
    totp: str | None = None


@router.post("/elevate")
async def elevate(body: ElevateIn, p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    """Re-authenticate to approve RESTRICTED actions for the next few minutes."""
    if not await app.ratelimiter.hit(f"elevate:{p.user_id}", limit=10, window_s=600):
        raise HTTPException(429, "too many attempts")
    ok = False
    if p.user.totp_enabled and body.totp:
        ok = pyotp.TOTP(app.box.decrypt(p.user.totp_secret_enc)).verify(body.totp.strip(), valid_window=1)
    elif body.password:
        ok = verify_password(p.user.password_hash, body.password)
    if not ok:
        raise HTTPException(401, "verification failed")
    until = utcnow() + timedelta(minutes=app.policy.config.elevation_minutes)
    async with app.sessionmaker() as session:
        row = await session.get(AuthSession, p.session.id)
        row.elevated_until = until
        await audit(session, action="auth.elevated", actor="user", user_id=p.user_id)
        await session.commit()
    return {"elevated_until": until.isoformat()}


@router.post("/totp/setup")
async def totp_setup(p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    secret = pyotp.random_base32()
    async with app.sessionmaker() as session:
        user = await session.get(User, p.user_id)
        user.totp_secret_enc = app.box.encrypt(secret)
        user.totp_enabled = False
        await session.commit()
    uri = pyotp.TOTP(secret).provisioning_uri(name=p.user.email, issuer_name="JARVIS")
    return {"secret": secret, "otpauth_uri": uri}


class CodeIn(BaseModel):
    code: str


@router.post("/totp/enable")
async def totp_enable(body: CodeIn, p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    async with app.sessionmaker() as session:
        user = await session.get(User, p.user_id)
        if not user.totp_secret_enc or not pyotp.TOTP(app.box.decrypt(user.totp_secret_enc)).verify(body.code, valid_window=1):
            raise HTTPException(400, "invalid code")
        user.totp_enabled = True
        await audit(session, action="auth.totp_enabled", actor="user", user_id=user.id)
        await session.commit()
    return {"ok": True}


@router.post("/totp/disable")
async def totp_disable(body: CodeIn, p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    if not p.user.totp_enabled or not pyotp.TOTP(app.box.decrypt(p.user.totp_secret_enc)).verify(body.code, valid_window=1):
        raise HTTPException(400, "invalid code")
    async with app.sessionmaker() as session:
        user = await session.get(User, p.user_id)
        user.totp_enabled = False
        user.totp_secret_enc = None
        await audit(session, action="auth.totp_disabled", actor="user", user_id=user.id)
        await session.commit()
    return {"ok": True}


class PasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=10)


@router.post("/password")
async def change_password(body: PasswordIn, p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    if not verify_password(p.user.password_hash, body.current_password):
        raise HTTPException(401, "current password is wrong")
    async with app.sessionmaker() as session:
        user = await session.get(User, p.user_id)
        user.password_hash = hash_password(body.new_password)
        # sign out every other session
        for s in (await session.execute(select(AuthSession).where(AuthSession.user_id == user.id,
                                                                   AuthSession.id != p.session.id,
                                                                   AuthSession.kind == "browser"))).scalars():
            s.revoked_at = utcnow()
        await audit(session, action="auth.password_changed", actor="user", user_id=user.id)
        await session.commit()
    return {"ok": True}


@router.get("/sessions")
async def sessions(p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    async with app.sessionmaker() as session:
        rows = (await session.execute(select(AuthSession).where(AuthSession.user_id == p.user_id,
                                                                AuthSession.revoked_at.is_(None))
                                      .order_by(AuthSession.last_seen_at.desc()))).scalars()
        return {"sessions": [{"id": str(r.id), "kind": r.kind, "name": r.name, "user_agent": r.user_agent,
                              "ip": r.ip, "created_at": r.created_at.isoformat(),
                              "last_seen_at": r.last_seen_at.isoformat(), "scopes": r.scopes,
                              "current": r.id == p.session.id} for r in rows]}


@router.delete("/sessions/{session_id}")
async def revoke(session_id: uuid.UUID, p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    async with app.sessionmaker() as session:
        row = await session.get(AuthSession, session_id)
        if row is None or row.user_id != p.user_id:
            raise HTTPException(404, "not found")
        row.revoked_at = utcnow()
        await audit(session, action="auth.session_revoked", actor="user", user_id=p.user_id,
                    data={"session": str(session_id), "kind": row.kind})
        await session.commit()
    return {"ok": True}


class DeviceIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    # voice: satellite/voice WS · chat: /api/chat · computer: desktop agent · *: everything (scripts)
    scopes: list[Literal["voice", "chat", "computer", "*"]] = Field(default_factory=lambda: ["voice", "chat"])
    ttl_days: int | None = Field(None, ge=1, le=3650)


@router.post("/devices")
async def create_device(body: DeviceIn, request: Request, p: Principal = Depends(current),
                        app: AppContext = Depends(get_app)) -> dict:
    if p.session.kind != "browser":
        raise HTTPException(403, "devices can only be created from a signed-in browser")
    token = await _issue(app, request, p.user, kind="device", name=body.name, scopes=body.scopes,
                         ttl_days=body.ttl_days or 0)
    return {"token": token, "note": "Shown once. Store it on the device (e.g. satellite .env)."}
