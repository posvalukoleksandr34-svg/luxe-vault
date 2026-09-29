"""Stripe: Checkout (subscribe), Customer Portal (manage/cancel), webhooks (the only way a paid plan starts).

Plain HTTPS calls (form-encoded, as Stripe's API expects) — no SDK dependency. Webhooks are verified with the
endpoint signing secret (`Stripe-Signature`: HMAC-SHA256 over "<t>.<payload>", 5-minute tolerance) and are
idempotent (each event id is applied once, table `billing_events`).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

import httpx
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from jarvis.core.audit import audit
from jarvis.core.logging import log
from jarvis.db.models import BillingEvent, Subscription, User

if TYPE_CHECKING:  # pragma: no cover
    from jarvis.core.container import AppContext

API = "https://api.stripe.com/v1"
TOLERANCE_S = 300


class BillingError(Exception):
    pass


def verify_signature(payload: bytes, header: str | None, secret: str, *, now: float | None = None) -> None:
    if not header:
        raise BillingError("missing Stripe-Signature")
    parts: dict[str, list[str]] = {}
    for item in header.split(","):
        k, _, v = item.strip().partition("=")
        parts.setdefault(k, []).append(v)
    try:
        ts = int(parts["t"][0])
    except (KeyError, ValueError) as exc:
        raise BillingError("malformed Stripe-Signature") from exc
    if abs((now or time.time()) - ts) > TOLERANCE_S:
        raise BillingError("stale webhook (timestamp outside tolerance)")
    expected = hmac.new(secret.encode(), f"{ts}.".encode() + payload, hashlib.sha256).hexdigest()
    if not any(hmac.compare_digest(expected, sig) for sig in parts.get("v1", [])):
        raise BillingError("invalid webhook signature")


def _flat(prefix: str, value: Any, out: list[tuple[str, str]]) -> None:
    if isinstance(value, dict):
        for k, v in value.items():
            _flat(f"{prefix}[{k}]" if prefix else k, v, out)
    elif isinstance(value, list):
        for i, v in enumerate(value):
            _flat(f"{prefix}[{i}]", v, out)
    elif value is not None:
        out.append((prefix, str(value).lower() if isinstance(value, bool) else str(value)))


def _ts(v: Any) -> datetime | None:
    return datetime.fromtimestamp(int(v), timezone.utc) if v else None


class StripeBilling:
    def __init__(self, app: "AppContext", transport: httpx.AsyncBaseTransport | None = None):
        self.app = app
        self.transport = transport

    async def configured(self) -> bool:
        return bool(await self.app.secrets.get("stripe_secret_key") and await self.app.secrets.get("stripe_webhook_secret"))

    async def _call(self, path: str, data: dict[str, Any]) -> dict[str, Any]:
        key = await self.app.secrets.get("stripe_secret_key")
        if not key:
            raise BillingError("payments are not configured (STRIPE_SECRET_KEY)")
        form: list[tuple[str, str]] = []
        _flat("", data, form)
        async with httpx.AsyncClient(timeout=30, transport=self.transport) as client:
            r = await client.post(f"{API}{path}", data=form, auth=(key, ""),
                                  headers={"Idempotency-Key": uuid.uuid4().hex})
        body = r.json() if r.content else {}
        if r.status_code >= 400:
            msg = (body.get("error") or {}).get("message") or f"HTTP {r.status_code}"
            log.warning("stripe.error", path=path, status=r.status_code)
            raise BillingError(f"payment provider error: {msg}")
        return body

    async def checkout(self, user: User, plan_id: str) -> str:
        plan = self.app.billing.catalog.plans.get(plan_id)
        if plan is None or plan.hidden or not plan.stripe_price:
            raise BillingError("this plan cannot be purchased (no Stripe price configured)")
        async with self.app.sessionmaker() as session:
            sub = (await session.execute(select(Subscription).where(Subscription.user_id == user.id))).scalar_one_or_none()
        data: dict[str, Any] = {
            "mode": "subscription", "line_items": [{"price": plan.stripe_price, "quantity": 1}],
            "success_url": f"{self.app.settings.public_url}/settings?billing=success#account",
            "cancel_url": f"{self.app.settings.public_url}/settings?billing=cancel#account",
            "client_reference_id": str(user.id), "metadata": {"user_id": str(user.id), "plan": plan.id},
            "subscription_data": {"metadata": {"user_id": str(user.id), "plan": plan.id}},
            "allow_promotion_codes": True,
        }
        if sub is not None and sub.customer_id:
            data["customer"] = sub.customer_id
        else:
            data["customer_email"] = user.email
        session_obj = await self._call("/checkout/sessions", data)
        return session_obj["url"]

    async def portal(self, user: User) -> str:
        async with self.app.sessionmaker() as session:
            sub = (await session.execute(select(Subscription).where(Subscription.user_id == user.id))).scalar_one_or_none()
        if sub is None or not sub.customer_id:
            raise BillingError("no paid subscription yet")
        obj = await self._call("/billing_portal/sessions", {
            "customer": sub.customer_id, "return_url": f"{self.app.settings.public_url}/settings#account"})
        return obj["url"]

    # ------------------------------------------------------------------ webhooks

    async def handle_webhook(self, payload: bytes, signature: str | None) -> dict[str, Any]:
        secret = await self.app.secrets.get("stripe_webhook_secret")
        if not secret:
            raise BillingError("webhook secret not configured")
        verify_signature(payload, signature, secret)
        event = json.loads(payload)
        return await self.apply(event)

    async def apply(self, event: dict[str, Any]) -> dict[str, Any]:
        etype, obj = event.get("type", ""), (event.get("data") or {}).get("object") or {}
        user_id = self._user_id(obj)
        async with self.app.sessionmaker() as session:
            session.add(BillingEvent(id=event["id"], provider="stripe", type=etype, user_id=user_id,
                                     summary={"object": obj.get("object"), "status": obj.get("status")}))
            try:
                await session.flush()
            except IntegrityError:
                return {"ok": True, "duplicate": True}
            changed = await self._apply(session, etype, obj, user_id)
            if changed is not None:
                await audit(session, action="billing.subscription_changed", actor="system", user_id=changed.user_id,
                            target=changed.plan, data={"status": changed.status, "event": etype})
            await session.commit()
        if changed is not None:
            self.app.billing.invalidate(changed.user_id)
            await self.app.billing.event(changed.user_id, f"billing.{etype.replace('customer.', '')}")
        return {"ok": True, "applied": changed is not None}

    @staticmethod
    def _user_id(obj: dict[str, Any]) -> uuid.UUID | None:
        raw = obj.get("client_reference_id") or (obj.get("metadata") or {}).get("user_id")
        try:
            return uuid.UUID(raw) if raw else None
        except ValueError:
            return None

    async def _apply(self, session, etype: str, obj: dict[str, Any], user_id: uuid.UUID | None) -> Subscription | None:
        cat = self.app.billing.catalog
        sub: Subscription | None = None
        if obj.get("object") == "subscription" and obj.get("id"):
            sub = (await session.execute(select(Subscription).where(Subscription.subscription_id == obj["id"]))).scalar_one_or_none()
        if sub is None and obj.get("object") == "invoice" and obj.get("subscription"):
            sub = (await session.execute(select(Subscription).where(
                Subscription.subscription_id == obj["subscription"]))).scalar_one_or_none()
        if sub is None and user_id is not None:
            if await session.get(User, user_id) is None:
                return None
            sub = (await session.execute(select(Subscription).where(Subscription.user_id == user_id))).scalar_one_or_none()
            if sub is None and etype in ("checkout.session.completed", "customer.subscription.created",
                                         "customer.subscription.updated"):
                sub = Subscription(user_id=user_id, plan=cat.default_plan, status="incomplete", provider="stripe")
                session.add(sub)
        if sub is None:
            log.info("stripe.event_unmatched", type=etype)
            return None

        if etype == "checkout.session.completed":
            sub.provider = "stripe"
            sub.customer_id = obj.get("customer") or sub.customer_id
            sub.subscription_id = obj.get("subscription") or sub.subscription_id
            plan = (obj.get("metadata") or {}).get("plan")
            if plan in cat.plans:
                sub.plan = plan
            if obj.get("payment_status") in ("paid", "no_payment_required"):
                sub.status = "active"
        elif etype in ("customer.subscription.created", "customer.subscription.updated",
                       "customer.subscription.deleted"):
            sub.provider = "stripe"
            sub.subscription_id = obj.get("id") or sub.subscription_id
            sub.customer_id = obj.get("customer") or sub.customer_id
            items = ((obj.get("items") or {}).get("data") or [])
            price = ((items[0] if items else {}).get("price") or {}).get("id")
            plan = cat.by_stripe_price(price)
            if plan is not None:
                sub.plan = plan.id
            elif (obj.get("metadata") or {}).get("plan") in cat.plans:
                sub.plan = obj["metadata"]["plan"]
            sub.status = "canceled" if etype.endswith("deleted") else (obj.get("status") or sub.status)
            sub.current_period_end = _ts(obj.get("current_period_end")) or sub.current_period_end
            sub.cancel_at_period_end = bool(obj.get("cancel_at_period_end"))
            sub.trial_ends_at = _ts(obj.get("trial_end"))
        elif etype == "invoice.payment_failed":
            sub.status = "past_due"
        elif etype == "invoice.paid":
            if sub.status in ("past_due", "incomplete", "unpaid"):
                sub.status = "active"
        else:
            return None
        return sub
