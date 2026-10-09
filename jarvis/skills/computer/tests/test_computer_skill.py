"""Computer control: DeviceHub routing + isolation, tool → agent round trip, screenshots reach the model."""

import asyncio
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest

from jarvis.devices.hub import DeviceError, DeviceHub, DeviceInfo
from jarvis.tools.base import ToolContext, ToolError
from jarvis.tools.executor import ToolExecutor
from jarvis.security.ratelimit import RateLimiter


@pytest.fixture
def computer():
    from jarvis.skills.manager import SkillManager
    from jarvis.tools.registry import ToolRegistry

    mgr = SkillManager(Path(__file__).parents[2], ToolRegistry(), None)
    mgr.discover()
    assert "computer" in mgr.skills, mgr.skills
    return mgr.registry


async def _fake_device(hub: DeviceHub, info: DeviceInfo, handler, stop: asyncio.Event):
    while not stop.is_set():
        call = await hub.next_call(info, timeout_s=0.2)
        if call is not None:
            ok, data, err = handler(call)
            await hub.deliver_reply(call["id"], {"ok": ok, "data": data, "error": err})


async def test_hub_routes_to_the_callers_device_only():
    hub = DeviceHub(None)
    alice, bob = str(uuid.uuid4()), str(uuid.uuid4())
    pc = DeviceInfo(id="d1", user_id=alice, name="Alice-PC", platform="windows 11", capabilities=["apps", "media"])
    await hub.register(pc)
    seen = []
    stop = asyncio.Event()
    loop = asyncio.create_task(_fake_device(hub, pc, lambda c: (seen.append(c), (True, {"opened": "chrome"}, None))[1],
                                            stop))
    try:
        data = await hub.call(alice, "apps.open", {"name": "chrome"})
        assert data == {"opened": "chrome", "device": "Alice-PC"} and seen[0]["action"] == "apps.open"
        with pytest.raises(DeviceError, match="no computer"):
            await hub.call(bob, "apps.open", {"name": "chrome"})  # Bob never reaches Alice's PC
        with pytest.raises(DeviceError, match="does not allow 'volume'"):
            await hub.call(alice, "volume.control", {"action": "mute"})
    finally:
        stop.set()
        await loop


async def test_hub_reports_device_failures_and_timeouts():
    hub = DeviceHub(None)
    uid = str(uuid.uuid4())
    pc = DeviceInfo(id="d2", user_id=uid, name="PC", platform="linux", capabilities=["apps"])
    await hub.register(pc)
    stop = asyncio.Event()
    loop = asyncio.create_task(_fake_device(hub, pc, lambda c: (False, {}, "application 'x' was not found"), stop))
    try:
        with pytest.raises(DeviceError, match="was not found"):
            await hub.call(uid, "apps.open", {"name": "x"})
    finally:
        stop.set()
        await loop
    with pytest.raises(DeviceError, match="did not answer"):
        await hub.call(uid, "apps.open", {"name": "x"}, timeout_s=0.3)


class FakeHub:
    def __init__(self, reply):
        self.reply, self.calls = reply, []

    async def call(self, user_id, action, args, **kw):
        self.calls.append((action, args))
        if isinstance(self.reply, Exception):
            raise self.reply
        return dict(self.reply)


def _ctx(hub):
    return ToolContext(app=SimpleNamespace(devices=hub), user_id=uuid.uuid4())


async def test_open_url_builds_searches_and_rejects_other_schemes(computer):
    spec = computer.get("computer_open_url")
    hub = FakeHub({"opened": "ok"})
    await spec.fn(_ctx(hub), spec.input_model(search="Daft Punk", site="youtube"))
    assert hub.calls[-1] == ("browser.open", {"url": "https://www.youtube.com/results?search_query=Daft+Punk"})
    await spec.fn(_ctx(hub), spec.input_model(url="spacex.com"))
    assert hub.calls[-1][1]["url"] == "https://spacex.com"
    with pytest.raises(ToolError):
        await spec.fn(_ctx(hub), spec.input_model(url="file:///etc/passwd"))


async def test_device_errors_become_honest_tool_errors(computer):
    spec = computer.get("computer_open_app")
    with pytest.raises(ToolError, match="desktop agent"):
        await spec.fn(_ctx(FakeHub(DeviceError("no computer is connected — start the JARVIS desktop agent"))),
                      spec.input_model(name="spotify"))


async def test_screenshot_is_given_to_the_model_as_an_image_not_text(computer):
    spec = computer.get("computer_screenshot")
    hub = FakeHub({"width": 1600, "height": 900, "png_base64": "iVBORw0KGgo="})
    outcome = await ToolExecutor(RateLimiter(None)).execute(spec, {}, _ctx(hub))
    assert outcome.ok and outcome.images == [{"media_type": "image/png", "data": "iVBORw0KGgo="}]
    assert "iVBORw0KGgo" not in outcome.content and "_image" not in (outcome.data or {})

    from jarvis.agent.harness import _result
    from jarvis.llm.openai_compat import to_openai_messages

    block = _result("t1", outcome.content, error=False, images=outcome.images)
    assert block["content"][1]["type"] == "image"
    msgs = to_openai_messages([], [{"role": "user", "content": [block]}])
    assert msgs[0]["role"] == "tool" and msgs[1]["content"][1]["image_url"]["url"].startswith("data:image/png")


def test_risk_tiers_match_the_product_policy(computer):
    from jarvis.permissions.policy import PolicyConfig, PolicyEngine
    from jarvis.skills.manager import SkillManager
    from jarvis.tools.registry import ToolRegistry

    root = Path(__file__).parents[3]
    mgr = SkillManager(root / "skills", ToolRegistry(), None)
    mgr.discover()
    cfg = PolicyConfig.load(root / "config" / "permissions.yaml")
    cfg.tools = {**mgr.permission_defaults(), **cfg.tools}
    policy = PolicyEngine(cfg)
    tier = lambda n: policy.decide(computer.get(n), rules={}, tainted=False).tier.value  # noqa: E731
    assert {n: tier(n) for n in ("computer_open_app", "computer_open_url", "computer_media", "computer_volume")} == \
        dict.fromkeys(("computer_open_app", "computer_open_url", "computer_media", "computer_volume"), "autonomous")
    for n in ("computer_close_app", "computer_type_text", "computer_mouse", "computer_clipboard", "computer_screenshot"):
        assert tier(n) == "confirm", n
    assert tier("computer_run") == "restricted"
    # after reading untrusted content, pausing music still works without a prompt; closing apps still asks
    assert policy.decide(computer.get("computer_media"), rules={}, tainted=True).tier.value == "autonomous"


async def test_calls_that_timed_out_never_run_later():
    hub = DeviceHub(None)
    uid = str(uuid.uuid4())
    pc = DeviceInfo(id="d3", user_id=uid, name="PC", platform="windows", capabilities=["apps"])
    await hub.register(pc)
    with pytest.raises(DeviceError, match="did not answer"):
        await hub.call(uid, "apps.open", {"name": "chrome"}, timeout_s=0.2)  # agent was busy/offline
    await asyncio.sleep(0.3)
    assert await hub.next_call(pc, timeout_s=0.1) is None  # the stale call is dropped, not executed
