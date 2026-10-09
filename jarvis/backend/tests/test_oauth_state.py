"""OAuth state tokens are signed, expiring and bound to one integration."""

import time
from types import SimpleNamespace

import pytest

from jarvis.integrations.oauth_state import sign_state, verify_state
from jarvis.tools.base import ToolError

APP = SimpleNamespace(box=SimpleNamespace(keys=["test-key"]))


def test_roundtrip_and_tamper():
    state = sign_state(APP, {"uid": "u1", "p": "spotify", "exp": int(time.time()) + 60})
    assert verify_state(APP, state)["p"] == "spotify"
    raw, sig = state.rsplit(".", 1)
    with pytest.raises(ToolError, match="signature"):
        verify_state(APP, raw + "x." + sig)
    with pytest.raises(ToolError, match="signature"):
        verify_state(SimpleNamespace(box=SimpleNamespace(keys=["other"])), state)


def test_expired():
    with pytest.raises(ToolError, match="expired"):
        verify_state(APP, sign_state(APP, {"uid": "u1", "exp": int(time.time()) - 1}))
