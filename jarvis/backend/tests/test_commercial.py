"""Commercial core against the real database (run with `make test-backend`)."""

import time
import uuid

import pytest

pytestmark = pytest.mark.integration


async def _member(app, plan=None):
    from jarvis.api.routes.auth import create_user
    from jarvis.db.models import Subscription

    u = await create_user(app, email=f"m{uuid.uuid4().hex[:10]}@test.local", password="correct horse battery",
                          name="Member", timezone="UTC", owner=False, verified=True)
    if plan:
        async with app.sessionmaker() as session:
            session.add(Subscription(user_id=u.id, plan=plan, status="manual", provider="manual"))
            await session.commit()
    app.billing.invalidate(u.id)
    return u


async def test_plan_comes_from_the_server_and_limits_messages(app, user):
    from jarvis.billing.service import QuotaExceeded

    assert (await app.billing.plan(user.id)).id == app.billing.catalog.owner_plan  # owner: never limited
    m = await _member(app)
    plan = await app.billing.plan(m.id)
    assert plan.id == app.billing.catalog.default_plan
    await app.billing.record(m.id, "messages", plan.limit("messages_month"))
    with pytest.raises(QuotaExceeded):
        await app.conversations.submit(user_id=m.id, text="hello")


async def test_features_are_masked_from_tool_availability(app):
    free = await _member(app)
    pro = await _member(app, plan="pro")
    assert (await app.availability(free.id))["spotify"] is False
    assert (await app.billing.allowed(pro.id, "spotify")) is True


async def test_stripe_webhook_is_verified_idempotent_and_sets_the_plan(app, api):
    import hashlib
    import hmac
    import json

    await app.secrets.set("stripe_secret_key", "sk_test_x")
    await app.secrets.set("stripe_webhook_secret", "whsec_test")
    try:
        m = await _member(app)
        event = {"id": f"evt_{uuid.uuid4().hex}", "type": "checkout.session.completed",
                 "data": {"object": {"object": "checkout.session", "client_reference_id": str(m.id),
                                     "customer": "cus_1", "subscription": f"sub_{uuid.uuid4().hex[:8]}",
                                     "payment_status": "paid", "metadata": {"plan": "pro"}}}}
        body = json.dumps(event).encode()
        ts = int(time.time())
        sig = hmac.new(b"whsec_test", f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
        bad = await api.post("/api/billing/webhook/stripe", content=body, headers={"Stripe-Signature": f"t={ts},v1=00"})
        assert bad.status_code == 400
        ok = await api.post("/api/billing/webhook/stripe", content=body, headers={"Stripe-Signature": f"t={ts},v1={sig}"})
        assert ok.status_code == 200 and ok.json()["applied"] is True
        again = await api.post("/api/billing/webhook/stripe", content=body, headers={"Stripe-Signature": f"t={ts},v1={sig}"})
        assert again.json().get("duplicate") is True
        app.billing.invalidate(m.id)
        assert (await app.billing.plan(m.id)).id == "pro"
    finally:
        await app.secrets.set("stripe_secret_key", None)
        await app.secrets.set("stripe_webhook_secret", None)


async def test_admin_is_owner_only_and_maintenance_blocks_members(app, api, authed):
    m = await _member(app)
    r = await authed.put("/api/admin/maintenance", json={"enabled": True, "message": "update"})
    assert r.status_code == 200
    try:
        from jarvis.api.routes.auth import _issue  # noqa: F401 — tokens are created via login below
        async with __import__("httpx").AsyncClient(transport=api._transport, base_url="http://testserver",
                                                   headers={"X-Jarvis-Request": "1"}) as other:
            login = await other.post("/api/auth/login", json={"email": m.email, "password": "correct horse battery"})
            assert login.status_code == 200
            assert (await other.get("/api/tasks")).status_code == 503
            assert (await other.get("/api/admin/overview")).status_code == 403
        assert (await authed.get("/api/tasks")).status_code == 200  # the owner keeps working
    finally:
        await authed.put("/api/admin/maintenance", json={"enabled": False, "message": ""})


async def test_export_contains_own_data_only_and_no_secrets(app, user):
    from jarvis.api.routes.account import export_user_data

    other = await _member(app)
    await app.conversations.submit(user_id=other.id, text="секрет другого пользователя")
    data = await export_user_data(app, user.id)
    blob = str(data)
    assert "password_hash" not in blob and "секрет другого пользователя" not in blob
    assert data["users"][0]["email"] == user.email
