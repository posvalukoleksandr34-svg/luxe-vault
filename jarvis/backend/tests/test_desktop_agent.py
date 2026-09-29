"""The desktop agent's own safety rules and action plumbing (run on Linux with stub programs)."""

import importlib.util
import os
import stat
import sys
from pathlib import Path

import pytest

AGENT = Path(__file__).resolve().parents[2] / "desktop" / "jarvis_desktop.py"


@pytest.fixture
def agent(monkeypatch, tmp_path):
    spec = importlib.util.spec_from_file_location("jarvis_desktop_under_test", AGENT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    monkeypatch.setattr(mod, "SYSTEM", "linux")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log = tmp_path / "calls.log"
    for name in ("playerctl", "pactl", "xdg-open", "google-chrome", "xdotool"):
        f = bin_dir / name
        f.write_text(f'#!/bin/sh\necho "{name} $*" >> "{log}"\n[ "$1" = get-sink-volume ] && echo "Volume: 40%"\nexit 0\n')
        f.chmod(f.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("PATH", f"{bin_dir}:{os.environ['PATH']}")
    mod._calls = log
    return mod


def calls(agent):
    return agent._calls.read_text().splitlines() if agent._calls.exists() else []


def test_apps_resolve_russian_names_and_refuse_paths(agent):
    assert agent.resolve_app("Хром")[0] == "chrome"
    assert agent.resolve_app("спотифай")[0] == "spotify"
    with pytest.raises(agent.ActionError, match="only application names"):
        agent.open_app("C:\\Windows\\System32\\evil.exe")
    with pytest.raises(agent.ActionError, match="only application names"):
        agent.open_app("rm -rf / ; echo")
    agent.open_app("chrome")
    import time; time.sleep(0.3)
    assert any(c.startswith("google-chrome") for c in calls(agent))


def test_allow_list_is_enforced(agent, monkeypatch):
    monkeypatch.setenv("JARVIS_ALLOWED_APPS", "spotify")
    with pytest.raises(agent.ActionError, match="ALLOWED_APPS"):
        agent.open_app("chrome")


def test_media_volume_and_urls(agent):
    agent.media_control("play_pause")
    assert agent.volume_control("set", 40)["volume"] == 40
    with pytest.raises(agent.ActionError):
        agent.open_url("file:///etc/passwd")
    agent.open_url("https://www.youtube.com/results?search_query=x")
    import time; time.sleep(0.3)
    log = calls(agent)
    assert "playerctl play-pause" in log and "pactl set-sink-volume @DEFAULT_SINK@ 40%" in log
    assert any(c.startswith("xdg-open https://www.youtube.com") for c in log)


async def test_disabled_capabilities_are_refused_locally(agent, monkeypatch):
    monkeypatch.setenv("JARVIS_ALLOW_SHELL", "0")
    monkeypatch.setenv("JARVIS_ALLOW_MEDIA", "0")
    a = agent.Agent("http://localhost", "t", "pc")
    assert a.caps["shell"] is False and a.caps["media"] is False and a.caps["apps"] is True
    r = await a.execute({"id": "1", "action": "shell.run", "args": {"command": "whoami"}})
    assert r == {"ok": False, "error": "'shell' is disabled on this computer"}
    r = await a.execute({"id": "2", "action": "media.control", "args": {"action": "next"}})
    assert not r["ok"]
    r = await a.execute({"id": "3", "action": "nope", "args": {}})
    assert r["error"] == "unknown action nope"
    r = await a.execute({"id": "4", "action": "apps.open", "args": {"name": "definitely-not-installed-app"}})
    assert r["ok"] is False and "not found" in r["error"]
