"""DB-free checks of the commercial core: plan catalogue, Stripe signatures, form encoding, quota messages."""

import hashlib
import hmac
import json
import time
from pathlib import Path

import pytest

from jarvis.billing.plans import Catalog
from jarvis.billing.service import QuotaExceeded
from jarvis.billing.stripe import BillingError, _flat, verify_signature

CONFIG = Path(__file__).parents[2] / "config" / "plans.yaml"


def test_catalog_loads_and_is_consistent():
    cat = Catalog.load(CONFIG)
    assert cat.default_plan in cat.plans and cat.owner_plan in cat.plans
    owner = cat.get(cat.owner_plan)
    assert owner.hidden and owner.has("computer") and owner.limit("messages_month") is None
    free = cat.get("free")
    assert not free.has("computer") and free.limit("messages_month") > 0
    assert cat.get("nonexistent").id == cat.default_plan  # unknown plan ids never grant more


def test_catalog_rejects_unknown_limits(tmp_path):
    bad = tmp_path / "plans.yaml"
    bad.write_text("default_plan: a\nowner_plan: a\nplans:\n  a: {limits: {messagez: 1}}\n")
    with pytest.raises(ValueError, match="unknown limits"):
        Catalog.load(bad)


def test_missing_catalog_means_unlimited_personal_install(tmp_path):
    cat = Catalog.load(tmp_path / "none.yaml")
    assert cat.get(None).has("computer") and cat.get(None).limit("messages_month") is None


def _sign(payload: bytes, secret: str, ts: int) -> str:
    sig = hmac.new(secret.encode(), f"{ts}.".encode() + payload, hashlib.sha256).hexdigest()
    return f"t={ts},v1={sig}"


def test_stripe_signature():
    body = json.dumps({"id": "evt_1"}).encode()
    now = int(time.time())
    verify_signature(body, _sign(body, "whsec_x", now), "whsec_x")
    with pytest.raises(BillingError, match="invalid"):
        verify_signature(body, _sign(body, "whsec_other", now), "whsec_x")
    with pytest.raises(BillingError, match="invalid"):
        verify_signature(body + b" ", _sign(body, "whsec_x", now), "whsec_x")
    with pytest.raises(BillingError, match="stale"):
        verify_signature(body, _sign(body, "whsec_x", now - 3600), "whsec_x")
    with pytest.raises(BillingError, match="missing"):
        verify_signature(body, None, "whsec_x")


def test_form_encoding_matches_stripe_conventions():
    out = []
    _flat("", {"line_items": [{"price": "price_1", "quantity": 1}], "metadata": {"plan": "pro"}, "x": True}, out)
    assert out == [("line_items[0][price]", "price_1"), ("line_items[0][quantity]", "1"),
                   ("metadata[plan]", "pro"), ("x", "true")]


def test_quota_messages_are_user_facing():
    free = Catalog.load(CONFIG).get("free")
    exc = QuotaExceeded("messages_month", 200, free)
    assert "200" in str(exc) and exc.payload()["code"] == "quota_exceeded"
    feat = QuotaExceeded("computer", 0, free, feature=True)
    assert feat.payload()["code"] == "feature_not_in_plan" and "Free" in str(feat)
