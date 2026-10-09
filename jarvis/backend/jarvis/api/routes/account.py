"""Accounts: sign-up (closed / invite / open), e-mail verification, password reset, plan & usage, onboarding,
data export and account deletion (GDPR-style self-service)."""

from __future__ import annotations

import contextlib
import json
import shutil
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, update

from jarvis.api.deps import Principal, current, get_app, require_owner
from jarvis.api.routes.auth import EMAIL, _issue, _set_cookie, create_user, user_payload
from jarvis.core.audit import audit
from jarvis.core.container import AppContext
from jarvis.core.mailer import MailError, Mailer
from jarvis.db.base import Base, utcnow
from jarvis.db.models import AuthSession, AuthToken, LLMCall, Subscription, Task, User
from jarvis.security.crypto import new_token, token_hash
from jarvis.security.passwords import hash_password, verify_password

router = APIRouter(tags=["account"])

# never exported: credentials, hashes, ciphertexts, vectors
SECRET_COLUMNS = {"password_hash", "totp_secret_enc", "credentials_enc", "token_hash", "code_hash", "secret_enc",
                  "embedding", "tsv", "prev_hash", "hash"}
SKIP_TABLES = {"auth_tokens", "memory_embeddings", "system_settings", "billing_events"}


# ------------------------------------------------------------------------------------------ one-time tokens

async def issue_token(app: AppContext, purpose: str, *, user_id: uuid.UUID | None = None, email: str | None = None,
                      ttl: timedelta) -> str:
    raw = new_token(f"jv_{purpose}")
    async with app.sessionmaker() as session:
        session.add(AuthToken(user_id=user_id, email=email, purpose=purpose, token_hash=token_hash(raw),
                              expires_at=utcnow() + ttl))
        await session.commit()
    return raw


async def consume_token(app: AppContext, purpose: str, raw: str) -> AuthToken:
    async with app.sessionmaker() as session:
        row = (await session.execute(select(AuthToken).where(AuthToken.token_hash == token_hash(raw.strip()),
                                                             AuthToken.purpose == purpose))).scalar_one_or_none()
        if row is None or row.used_at is not None or row.expires_at < utcnow():
            raise HTTPException(400, "the link is invalid or expired")
        row.used_at = utcnow()
        await session.commit()
        return row


def _mailer(app: AppContext) -> Mailer:
    return Mailer(app)


async def _send_verification(app: AppContext, user: User) -> bool:
    mailer = _mailer(app)
    if not mailer.configured():
        return False
    raw = await issue_token(app, "verify", user_id=user.id, ttl=timedelta(days=2))
    with contextlib.suppress(MailError):
        await mailer.send(user.email, f"{app.settings.product_name}: подтвердите e-mail",
                          f"Здравствуйте, {user.display_name}!\n\nПодтвердите адрес, чтобы войти в "
                          f"{app.settings.product_name}:\n{app.settings.public_url}/verify?token={raw}\n\n"
                          "Ссылка действует 48 часов. Если вы не регистрировались — просто проигнорируйте письмо.")
        return True
    return False


# ------------------------------------------------------------------------------------------ sign-up

class SignupIn(BaseModel):
    email: str = Field(pattern=EMAIL, max_length=320)
    password: str = Field(min_length=10, max_length=200)
    name: str = Field("", max_length=200)
    timezone: str = Field("UTC", max_length=64)
    invite: str | None = Field(None, max_length=200)
    accept_terms: bool = False


@router.post("/api/auth/signup")
async def signup(body: SignupIn, request: Request, response: Response, app: AppContext = Depends(get_app)) -> dict:
    mode = app.settings.signup_mode
    if mode == "closed" or not await app.billing.flag("signup"):
        raise HTTPException(403, "sign-up is closed on this JARVIS — ask the owner for an account")
    if not body.accept_terms:
        raise HTTPException(400, "please accept the terms and the privacy policy")
    ip = request.client.host if request.client else "-"
    if not await app.ratelimiter.hit(f"signup:{ip}", limit=5, window_s=3600):
        raise HTTPException(429, "too many sign-ups from this address, try later")
    email = body.email.lower()
    if mode == "invite":
        if not body.invite:
            raise HTTPException(403, "an invite code is required")
        invite = await consume_token(app, "invite", body.invite)
        if invite.email and invite.email.lower() != email:
            raise HTTPException(403, "this invite is for another e-mail address")
    async with app.sessionmaker() as session:
        exists = (await session.execute(select(User.id).where(User.email == email))).scalar_one_or_none()
    mailer_ok = _mailer(app).configured()
    if exists:  # same answer as a new sign-up: the form must not reveal who has an account
        return {"ok": True, "next": "verify_email" if mailer_ok else "login"}
    # without SMTP verification cannot be enforced; the account stays unverified (visible in Admin)
    user = await create_user(app, email=email, password=body.password, name=body.name or email.split("@")[0],
                             timezone=body.timezone, owner=False, verified=False)
    cat = app.billing.catalog
    async with app.sessionmaker() as session:
        if cat.trial_days and cat.trial_plan:
            session.add(Subscription(user_id=user.id, plan=cat.trial_plan, status="trialing", provider="manual",
                                     trial_ends_at=utcnow() + timedelta(days=cat.trial_days)))
        await audit(session, action="account.signup", actor="user", user_id=user.id, data={"mode": mode})
        await session.commit()
    await app.billing.event(user.id, "signup")
    if mailer_ok:
        await _send_verification(app, user)
        return {"ok": True, "next": "verify_email"}
    _set_cookie(response, app, await _issue(app, request, user))
    return {"ok": True, "next": "app", "user": user_payload(user)}


class TokenIn(BaseModel):
    token: str = Field(min_length=10, max_length=300)


@router.post("/api/auth/verify")
async def verify_email(body: TokenIn, app: AppContext = Depends(get_app)) -> dict:
    row = await consume_token(app, "verify", body.token)
    async with app.sessionmaker() as session:
        user = await session.get(User, row.user_id)
        if user is None:
            raise HTTPException(400, "the link is invalid or expired")
        user.email_verified_at = user.email_verified_at or utcnow()
        await audit(session, action="account.email_verified", actor="user", user_id=user.id)
        await session.commit()
    return {"ok": True}


@router.post("/api/auth/verify/resend")
async def resend_verification(p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    if p.user.email_verified_at:
        return {"ok": True, "sent": False, "reason": "already verified"}
    if not await app.ratelimiter.hit(f"verify:{p.user_id}", limit=3, window_s=3600):
        raise HTTPException(429, "too many requests")
    sent = await _send_verification(app, p.user)
    return {"ok": sent, "sent": sent, "reason": None if sent else "e-mail is not configured on this server"}


class ForgotIn(BaseModel):
    email: str = Field(pattern=EMAIL, max_length=320)


@router.post("/api/auth/password/forgot")
async def forgot_password(body: ForgotIn, request: Request, app: AppContext = Depends(get_app)) -> dict:
    mailer = _mailer(app)
    if not mailer.configured():
        return {"ok": False, "reason": "email_not_configured"}
    ip = request.client.host if request.client else "-"
    if not await app.ratelimiter.hit(f"forgot:{ip}", limit=5, window_s=3600):
        raise HTTPException(429, "too many requests")
    async with app.sessionmaker() as session:
        user = (await session.execute(select(User).where(User.email == body.email.lower()))).scalar_one_or_none()
    if user is not None and user.disabled_at is None:
        raw = await issue_token(app, "reset", user_id=user.id, ttl=timedelta(hours=1))
        with contextlib.suppress(MailError):
            await mailer.send(user.email, f"{app.settings.product_name}: сброс пароля",
                              f"Чтобы задать новый пароль, откройте ссылку (действует 1 час):\n"
                              f"{app.settings.public_url}/reset?token={raw}\n\n"
                              "Если вы не запрашивали сброс — ничего не делайте, пароль останется прежним.")
    return {"ok": True}  # same answer whether or not the account exists


class ResetIn(BaseModel):
    token: str = Field(min_length=10, max_length=300)
    new_password: str = Field(min_length=10, max_length=200)


@router.post("/api/auth/password/reset")
async def reset_password(body: ResetIn, app: AppContext = Depends(get_app)) -> dict:
    row = await consume_token(app, "reset", body.token)
    async with app.sessionmaker() as session:
        user = await session.get(User, row.user_id)
        if user is None:
            raise HTTPException(400, "the link is invalid or expired")
        user.password_hash = hash_password(body.new_password)
        user.failed_logins = 0
        user.locked_until = None
        user.email_verified_at = user.email_verified_at or utcnow()  # they proved access to the mailbox
        await session.execute(update(AuthSession).where(AuthSession.user_id == user.id,
                                                        AuthSession.revoked_at.is_(None)).values(revoked_at=utcnow()))
        await audit(session, action="auth.password_reset", actor="user", user_id=user.id)
        await session.commit()
    return {"ok": True}


# ------------------------------------------------------------------------------------------ invites (owner)

class InviteIn(BaseModel):
    email: str | None = Field(None, pattern=EMAIL, max_length=320)
    days: int = Field(7, ge=1, le=90)


@router.post("/api/admin/invites")
async def create_invite(body: InviteIn, p: Principal = Depends(require_owner), app: AppContext = Depends(get_app)) -> dict:
    raw = await issue_token(app, "invite", email=body.email.lower() if body.email else None, ttl=timedelta(days=body.days))
    link = f"{app.settings.public_url}/signup?invite={raw}"
    sent = False
    if body.email and _mailer(app).configured():
        with contextlib.suppress(MailError):
            await _mailer(app).send(body.email, f"Приглашение в {app.settings.product_name}",
                                    f"Вас пригласили в {app.settings.product_name}. Регистрация:\n{link}\n\n"
                                    f"Ссылка действует {body.days} дн.")
            sent = True
    async with app.sessionmaker() as session:
        await audit(session, action="account.invite_created", actor="user", user_id=p.user_id,
                    data={"email": body.email, "days": body.days})
        await session.commit()
    return {"code": raw, "link": link, "emailed": sent, "signup_mode": app.settings.signup_mode}


# ------------------------------------------------------------------------------------------ plan, usage, onboarding

@router.get("/api/account")
async def account(p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    plan = await app.billing.plan(p.user_id)
    from jarvis.billing.stripe import StripeBilling

    return {"user": {**user_payload(p.user), "email_verified": bool(p.user.email_verified_at),
                     "onboarded": bool(p.user.onboarded_at)},
            "plan": plan.public(), "subscription": await app.billing.subscription(p.user_id),
            "usage": await app.billing.usage(p.user_id),
            "billing": {"configured": await StripeBilling(app).configured()},
            "plans": [pl.public() for pl in app.billing.catalog.plans.values() if not pl.hidden]}


@router.post("/api/account/onboarding")
async def finish_onboarding(p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    async with app.sessionmaker() as session:
        user = await session.get(User, p.user_id)
        user.onboarded_at = user.onboarded_at or utcnow()
        await session.commit()
    await app.billing.event(p.user_id, "onboarding_done")
    return {"ok": True}


# ------------------------------------------------------------------------------------------ export / delete

def _plain(v: Any) -> Any:
    if isinstance(v, (uuid.UUID, datetime)):
        return str(v)
    if isinstance(v, (bytes, bytearray, memoryview)):
        return None
    if isinstance(v, (list, tuple)) and v and isinstance(v[0], float) and len(v) > 64:
        return None  # vectors
    return v


async def export_user_data(app: AppContext, user_id: uuid.UUID) -> dict[str, Any]:
    out: dict[str, Any] = {"format": "jarvis-export/1", "exported_at": datetime.now(timezone.utc).isoformat()}
    tables = Base.metadata.tables
    async with app.sessionmaker() as session:
        for name, table in tables.items():
            if name in SKIP_TABLES:
                continue
            cols = [c for c in table.c if c.name not in SECRET_COLUMNS and not c.name.endswith("_tsv")]
            if name == "users":
                stmt = select(*cols).where(table.c.id == user_id)
            elif "user_id" in table.c:
                stmt = select(*cols).where(table.c.user_id == user_id)
            elif name == "messages":
                conv = tables["conversations"]
                stmt = select(*cols).where(table.c.conversation_id.in_(select(conv.c.id).where(conv.c.user_id == user_id)))
            elif "task_id" in table.c:
                stmt = select(*cols).where(table.c.task_id.in_(select(Task.id).where(Task.user_id == user_id)))
            else:
                continue
            rows = (await session.execute(stmt)).mappings().all()
            out[name] = [{k: _plain(v) for k, v in r.items()} for r in rows]
    return out


@router.get("/api/account/export")
async def export_account(p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> Response:
    if not p.elevated:
        raise HTTPException(428, {"code": "elevation_required", "message": "re-authenticate to export your data"})
    data = await export_user_data(app, p.user_id)
    async with app.sessionmaker() as session:
        await audit(session, action="account.exported", actor="user", user_id=p.user_id)
        await session.commit()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    return Response(json.dumps(data, ensure_ascii=False, indent=1, default=str), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="jarvis-export-{stamp}.json"'})


class DeleteIn(BaseModel):
    password: str
    confirm_email: str


@router.post("/api/account/delete")
async def delete_account(body: DeleteIn, response: Response, p: Principal = Depends(current),
                         app: AppContext = Depends(get_app)) -> dict:
    if not p.elevated:
        raise HTTPException(428, {"code": "elevation_required", "message": "re-authenticate to delete the account"})
    if p.user.is_owner:
        raise HTTPException(409, "the owner account cannot be deleted from the app (it owns this installation)")
    if body.confirm_email.strip().lower() != p.user.email or not verify_password(p.user.password_hash, body.password):
        raise HTTPException(400, "password or e-mail confirmation does not match")
    async with app.sessionmaker() as session:
        sub = (await session.execute(select(Subscription).where(Subscription.user_id == p.user_id))).scalar_one_or_none()
        if sub is not None and sub.provider == "stripe" and sub.status in ("active", "trialing", "past_due") \
                and not sub.cancel_at_period_end:
            raise HTTPException(409, "cancel the paid subscription first (Settings → Account → Manage billing)")
        user_id = p.user_id
        await session.execute(delete(LLMCall).where(LLMCall.user_id == user_id))
        await session.execute(delete(User).where(User.id == user_id))  # everything else cascades
        # the append-only audit log keeps a pseudonymous record (user id) of security events; see docs/PRIVACY.md
        await audit(session, action="account.deleted", actor="user", user_id=user_id)
        await session.commit()
    with contextlib.suppress(Exception):
        shutil.rmtree(app.files.for_tenant(user_id).root, ignore_errors=True)
    if app.redis is not None:
        with contextlib.suppress(Exception):
            await app.redis.delete(f"jarvis:devices:{user_id}")
    app.billing.invalidate(user_id)
    from jarvis.api.deps import COOKIE

    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}
