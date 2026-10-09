"""Spotify skill against a mocked Web API: search → play, Premium / no-device errors, desktop fallback."""

import json
import uuid
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from jarvis.devices.hub import DeviceHub, DeviceInfo
from jarvis.tools.base import ToolContext, ToolError


@pytest.fixture
def tools():
    from jarvis.skills.manager import SkillManager
    from jarvis.tools.registry import ToolRegistry

    mgr = SkillManager(Path(__file__).parents[2], ToolRegistry(), None)
    mgr.discover()
    assert "spotify" in mgr.skills
    return mgr.registry


class FakeSpotify:
    def __init__(self, *, premium=True, devices=None):
        self.premium = premium
        self.devices = devices if devices is not None else [{"id": "pc1", "name": "DESKTOP", "is_active": True}]
        self.calls = []
        self.transport = httpx.MockTransport(self.handle)

    async def access_token(self, user_id):
        return "tok"

    def handle(self, request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer tok"
        path = request.url.path.removeprefix("/v1")
        self.calls.append((request.method, path, dict(request.url.params),
                           json.loads(request.content) if request.content else None))
        if path == "/search":
            kind = request.url.params["type"]
            return httpx.Response(200, json={f"{kind}s": {"items": [
                {"name": "Believer", "uri": "spotify:track:abc", "artists": [{"name": "Imagine Dragons"}]}]}})
        if path == "/me/player/devices":
            return httpx.Response(200, json={"devices": self.devices})
        if path.startswith("/me/player/") or path == "/me/player":
            if request.method == "GET":
                return httpx.Response(200, json={"is_playing": True, "device": {"name": "DESKTOP", "volume_percent": 50},
                                                  "item": {"name": "Believer", "artists": [{"name": "Imagine Dragons"}],
                                                           "album": {"name": "Evolve"}, "uri": "spotify:track:abc",
                                                           "duration_ms": 204000}})
            if not self.premium:
                return httpx.Response(403, json={"error": {"status": 403, "message": "Player command failed: Premium required",
                                                           "reason": "PREMIUM_REQUIRED"}})
            return httpx.Response(204)
        return httpx.Response(404, json={"error": {"message": "unexpected " + path}})


def _ctx(fake, devices=None):
    app = SimpleNamespace(spotify=fake, devices=devices)
    return ToolContext(app=app, user_id=uuid.uuid4(), task_id=None, conversation_id=None, channel="web")


async def _run(tools, name, ctx, **args):
    t = tools.get(name)
    return await t.fn(ctx, t.input_model(**args))


async def test_play_searches_and_starts_the_track(tools):
    fake = FakeSpotify()
    out = await _run(tools, "spotify_play", _ctx(fake), query="Imagine Dragons Believer")
    assert out["playing"]["name"] == "Believer" and out["device_id"] == "pc1"
    method, path, params, body = fake.calls[-1]
    assert (method, path, params, body) == ("PUT", "/me/player/play", {"device_id": "pc1"}, {"uris": ["spotify:track:abc"]})


async def test_playlist_uses_context_uri_and_controls(tools):
    fake = FakeSpotify()
    await _run(tools, "spotify_play", _ctx(fake), uri="spotify:playlist:xyz", kind="playlist")
    assert fake.calls[-1][3] == {"context_uri": "spotify:playlist:xyz"}
    out = await _run(tools, "spotify_control", _ctx(fake), action="volume", value=30)
    assert out == {"done": "volume", "volume": 30} and fake.calls[-1][2] == {"volume_percent": "30"}
    now = await _run(tools, "spotify_now_playing", _ctx(fake))
    assert now["track"]["artists"] == "Imagine Dragons" and now["device"] == "DESKTOP"


async def test_premium_required_is_reported_honestly(tools):
    with pytest.raises(ToolError, match="Premium"):
        await _run(tools, "spotify_control", _ctx(FakeSpotify(premium=False)), action="pause")


async def test_no_device_and_no_desktop_agent(tools):
    with pytest.raises(ToolError, match="no Spotify device"):
        await _run(tools, "spotify_play", _ctx(FakeSpotify(devices=[]), devices=DeviceHub(None)), query="x")


async def test_no_device_starts_spotify_on_the_pc(tools, monkeypatch):
    fake = FakeSpotify(devices=[])
    hub = DeviceHub(None)
    ctx = _ctx(fake, devices=hub)
    await hub.register(DeviceInfo(id="d", user_id=str(ctx.user_id), name="PC", platform="windows", capabilities=["apps"]))
    opened = []

    async def call(user_id, action, args, **kw):
        opened.append((action, args))
        fake.devices = [{"id": "pc9", "name": "PC", "is_active": False}]  # the app registered with Spotify Connect
        return {"opened": "spotify"}

    async def no_sleep(_):
        return None

    monkeypatch.setattr(hub, "call", call)
    monkeypatch.setattr("jarvis.integrations.spotify.asyncio.sleep", no_sleep)
    out = await _run(tools, "spotify_play", ctx, query="Believer")
    assert opened == [("apps.open", {"name": "spotify"})] and out["device_id"] == "pc9"
    assert ("PUT", "/me/player", {}, {"device_ids": ["pc9"], "play": False}) in fake.calls
