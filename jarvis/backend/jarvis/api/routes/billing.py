"""Billing: start a checkout, open the customer portal, receive payment webhooks."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from jarvis.api.deps import Principal, current, get_app
from jarvis.billing.stripe import BillingError, StripeBilling
from jarvis.core.container import AppContext
from jarvis.core.logging import log

router = APIRouter(prefix="/api/billing", tags=["billing"])


class CheckoutIn(BaseModel):
    plan: str = Field(min_length=1, max_length=32)


@router.post("/checkout")
async def checkout(body: CheckoutIn, p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    if p.user.is_owner:
        raise HTTPException(400, "the owner account is not billed")
    try:
        url = await StripeBilling(app).checkout(p.user, body.plan)
    except BillingError as exc:
        raise HTTPException(400, str(exc)) from exc
    await app.billing.event(p.user_id, "checkout_started")
    return {"url": url}


@router.post("/portal")
async def portal(p: Principal = Depends(current), app: AppContext = Depends(get_app)) -> dict:
    try:
        return {"url": await StripeBilling(app).portal(p.user)}
    except BillingError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/webhook/stripe", include_in_schema=False)
async def stripe_webhook(request: Request, app: AppContext = Depends(get_app)) -> dict:
    payload = await request.body()
    try:
        return await StripeBilling(app).handle_webhook(payload, request.headers.get("stripe-signature"))
    except BillingError as exc:
        log.warning("stripe.webhook_rejected", reason=str(exc))
        raise HTTPException(400, "invalid webhook") from exc
