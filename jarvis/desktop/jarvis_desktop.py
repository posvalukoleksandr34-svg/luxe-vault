#!/usr/bin/env python3
"""JARVIS desktop agent — lets your JARVIS act on this computer.

It keeps one WebSocket open to your JARVIS server (`/api/ws/device`, device token with the `computer`
scope) and executes the actions JARVIS asks for: open/close apps, media keys, volume, open links, windows,
keyboard, mouse, clipboard, screenshots and (only if you enable it) shell commands.

Safety:
  * JARVIS decides *whether* an action may run (permission tiers, confirmations, audit log) before the
    call ever reaches this agent. This agent adds a local kill switch per capability (see .env.example):
    anything you disable here is refused even if the server asks.
  * Shell commands are OFF unless JARVIS_ALLOW_SHELL=1.
  * App names are never passed to a shell; paths and executables outside the known/Start-menu apps are
    refused (JARVIS_ALLOWED_APPS narrows it further).

Run:  python jarvis_desktop.py [--config path/to/.env] [--check]
Windows: scripts/windows/install-desktop-agent.bat installs it to start silently at sign-in.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import io
import json
import logging
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import time
import unicodedata
from pathlib import Path
from typing import Any, Callable

VERSION = "1.0.0"
SYSTEM = {"Windows": "windows", "Darwin": "mac"}.get(platform.system(), "linux")
log = logging.getLogger("jarvis-desktop")


# ---------------------------------------------------------------------------------------------- config

def load_env(path: Path | None) -> None:
    candidates = [path] if path else [Path(__file__).with_name(".env"),
                                      Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "JARVIS" / "desktop.env"]
    for p in candidates:
        if p and p.exists():
            for line in p.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
            return


def flag(name: str, default: bool) -> bool:
    v = os.environ.get(name)
    return default if v is None or v == "" else v.strip().lower() in ("1", "true", "yes", "on")


class ActionError(Exception):
    pass


def run(cmd: list[str], *, timeout: float = 15, input_text: str | None = None, check: bool = True) -> str:
    """Run a program without a shell. Output is text."""
    kwargs: dict[str, Any] = {}
    if SYSTEM == "windows":
        kwargs["creationflags"] = 0x08000000  # CREATE_NO_WINDOW
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, input=input_text,
                           encoding="utf-8", errors="replace", **kwargs)
    except FileNotFoundError as exc:
        raise ActionError(f"{cmd[0]} is not installed") from exc
    except subprocess.TimeoutExpired as exc:
        raise ActionError(f"{cmd[0]} timed out") from exc
    if check and r.returncode != 0:
        raise ActionError((r.stderr or r.stdout or f"{cmd[0]} failed").strip()[:300])
    return r.stdout


def spawn(cmd: list[str]) -> None:
    """Start a GUI program detached from this agent."""
    kwargs: dict[str, Any] = {"stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
    if SYSTEM == "windows":
        kwargs["creationflags"] = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    try:
        subprocess.Popen(cmd, **kwargs)
    except FileNotFoundError as exc:
        raise ActionError(f"{cmd[0]} was not found") from exc


# ---------------------------------------------------------------------------------------------- apps

def norm(name: str) -> str:
    s = unicodedata.normalize("NFKC", name).lower().strip()
    s = re.sub(r"[\"'«»]", "", s).strip(" .,!?;:")
    return re.sub(r"\s+", " ", s)


# name → how to start it per OS, and which processes are "it" when closing
APPS: dict[str, dict[str, Any]] = {
    "chrome": {"aliases": ["google chrome", "хром", "гугл хром", "браузер хром"],
               "windows": ["chrome"], "linux": ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"],
               "mac": "Google Chrome", "proc": ["chrome", "google-chrome", "chromium", "google chrome"]},
    "edge": {"aliases": ["microsoft edge", "эдж"], "windows": ["msedge"], "linux": ["microsoft-edge"],
             "mac": "Microsoft Edge", "proc": ["msedge", "microsoft-edge", "microsoft edge"]},
    "firefox": {"aliases": ["файрфокс", "мозилла"], "windows": ["firefox"], "linux": ["firefox"], "mac": "Firefox",
                "proc": ["firefox"]},
    "spotify": {"aliases": ["спотифай", "спотик"], "windows": ["uri:spotify:"], "linux": ["spotify"], "mac": "Spotify",
                "proc": ["spotify"]},
    "discord": {"aliases": ["дискорд", "дс"], "windows": ["discord:%LOCALAPPDATA%\\Discord\\Update.exe"],
                "linux": ["discord"], "mac": "Discord", "proc": ["discord"]},
    "steam": {"aliases": ["стим"], "windows": ["uri:steam://open/main"], "linux": ["steam"], "mac": "Steam",
              "proc": ["steam", "steamwebhelper"]},
    "vscode": {"aliases": ["vs code", "visual studio code", "code", "вскод", "вс код"],
               "windows": ["code", "%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe"], "linux": ["code"],
               "mac": "Visual Studio Code", "proc": ["code"]},
    "telegram": {"aliases": ["телеграм", "телега", "telegram desktop"],
                 "windows": ["%APPDATA%\\Telegram Desktop\\Telegram.exe", "uri:tg://"],
                 "linux": ["telegram-desktop", "telegram"], "mac": "Telegram", "proc": ["telegram", "telegram-desktop"]},
    "notepad": {"aliases": ["блокнот"], "windows": ["notepad"], "linux": ["gnome-text-editor", "gedit", "kate", "mousepad"],
                "mac": "TextEdit", "proc": ["notepad", "gedit", "gnome-text-editor", "textedit"]},
    "calculator": {"aliases": ["калькулятор", "calc"], "windows": ["calc"], "linux": ["gnome-calculator", "kcalc"],
                   "mac": "Calculator", "proc": ["calculatorapp", "calculator", "gnome-calculator"]},
    "explorer": {"aliases": ["проводник", "файлы", "files", "file explorer", "finder"], "windows": ["explorer"],
                 "linux": ["nautilus", "dolphin", "thunar"], "mac": "Finder", "proc": []},
    "terminal": {"aliases": ["терминал", "консоль", "cmd", "powershell"], "windows": ["wt", "powershell"],
                 "linux": ["x-terminal-emulator", "gnome-terminal", "konsole"], "mac": "Terminal", "proc": []},
    "settings": {"aliases": ["настройки", "параметры"], "windows": ["uri:ms-settings:"], "linux": ["gnome-control-center"],
                 "mac": "System Settings", "proc": []},
    "task manager": {"aliases": ["диспетчер задач"], "windows": ["taskmgr"], "linux": ["gnome-system-monitor"],
                     "mac": "Activity Monitor", "proc": ["taskmgr"]},
    "obs": {"aliases": ["obs studio"], "windows": ["obs64"], "linux": ["obs"], "mac": "OBS", "proc": ["obs64", "obs"]},
    "slack": {"aliases": ["слак"], "windows": ["slack"], "linux": ["slack"], "mac": "Slack", "proc": ["slack"]},
    "zoom": {"aliases": ["зум"], "windows": ["zoom"], "linux": ["zoom"], "mac": "zoom.us", "proc": ["zoom"]},
    "word": {"aliases": ["ворд", "microsoft word"], "windows": ["winword"], "linux": ["libreoffice --writer"],
             "mac": "Microsoft Word", "proc": ["winword"]},
    "excel": {"aliases": ["эксель", "microsoft excel"], "windows": ["excel"], "linux": ["libreoffice --calc"],
              "mac": "Microsoft Excel", "proc": ["excel"]},
    "whatsapp": {"aliases": ["ватсап", "вотсап"], "windows": ["uri:whatsapp:"], "linux": [], "mac": "WhatsApp",
                 "proc": ["whatsapp"]},
}
SAFE_NAME = re.compile(r"^[\w .+\-]{1,80}$", re.UNICODE)


def resolve_app(name: str) -> tuple[str, dict[str, Any] | None]:
    n = norm(name)
    for key, spec in APPS.items():
        if n == key or n in spec["aliases"]:
            return key, spec
    return n, None


def allowed_apps() -> set[str] | None:
    raw = os.environ.get("JARVIS_ALLOWED_APPS", "").strip()
    return {norm(x) for x in raw.split(",") if x.strip()} if raw else None


def _expand(path: str) -> str:
    return os.path.expandvars(path)


def _start_menu_lookup(n: str) -> Path | None:
    roots = [Path(os.environ.get("APPDATA", "")) / "Microsoft/Windows/Start Menu/Programs",
             Path(os.environ.get("PROGRAMDATA", "")) / "Microsoft/Windows/Start Menu/Programs"]
    best: tuple[int, Path] | None = None
    for root in roots:
        if not root.exists():
            continue
        for lnk in root.rglob("*.lnk"):
            stem = norm(lnk.stem)
            if "uninstall" in stem or "удален" in stem:
                continue
            score = 0 if stem == n else (1 if stem.startswith(n) else (2 if n in stem else None))
            if score is not None and (best is None or score < best[0]):
                best = (score, lnk)
    return best[1] if best else None


def open_app(name: str) -> dict:
    key, spec = resolve_app(name)
    allow = allowed_apps()
    if allow is not None and key not in allow and norm(name) not in allow:
        raise ActionError(f"'{name}' is not in JARVIS_ALLOWED_APPS on this computer")
    if spec is None and not SAFE_NAME.match(key):
        raise ActionError("only application names are accepted, not paths or commands")
    targets = (spec or {}).get(SYSTEM) if spec else None
    if SYSTEM == "mac":
        app = targets or name
        run(["open", "-a", app])
        return {"opened": key, "how": f"open -a {app}"}
    for t in (targets or []):
        if t.startswith("uri:"):
            uri = t[4:]
            if SYSTEM == "windows":
                os.startfile(uri)  # type: ignore[attr-defined]  # noqa: S606
            else:
                spawn(["xdg-open", uri])
            return {"opened": key, "how": uri}
        if t.startswith("discord:"):
            exe = _expand(t.split(":", 1)[1])
            if Path(exe).exists():
                spawn([exe, "--processStart", "Discord.exe"])
                return {"opened": key, "how": "Discord Update.exe"}
            continue
        parts = t.split()
        exe = _expand(parts[0])
        if Path(exe).is_absolute():
            if Path(exe).exists():
                spawn([exe, *parts[1:]])
                return {"opened": key, "how": exe}
            continue
        found = shutil.which(exe)
        if found:
            spawn([found, *parts[1:]])
            return {"opened": key, "how": found}
        if SYSTEM == "windows":
            try:  # App Paths registry (chrome, msedge, winword…)
                os.startfile(exe)  # type: ignore[attr-defined]  # noqa: S606
                return {"opened": key, "how": f"App Paths: {exe}"}
            except OSError:
                continue
    if SYSTEM == "windows":
        lnk = _start_menu_lookup(key if spec is None else norm(name))
        if lnk is None and spec is not None:
            lnk = _start_menu_lookup(key)
        if lnk is not None:
            os.startfile(str(lnk))  # type: ignore[attr-defined]  # noqa: S606
            return {"opened": key, "how": f"Start menu: {lnk.stem}"}
        try:
            os.startfile(key)  # type: ignore[attr-defined]  # noqa: S606
            return {"opened": key, "how": f"App Paths: {key}"}
        except OSError:
            pass
    else:
        found = shutil.which(key.replace(" ", "-")) or shutil.which(key)
        if found:
            spawn([found])
            return {"opened": key, "how": found}
    raise ActionError(f"application '{name}' was not found on this computer")


def _process_names(name: str) -> list[str]:
    key, spec = resolve_app(name)
    names = list((spec or {}).get("proc") or []) or [key]
    return [norm(n) for n in names if n]


def close_app(name: str, force: bool = False) -> dict:
    key, _ = resolve_app(name)
    wanted = _process_names(name)
    if not wanted:
        raise ActionError(f"'{name}' cannot be closed this way")
    closed: list[str] = []
    try:
        import psutil  # type: ignore
    except ImportError:
        psutil = None
    if SYSTEM == "windows":
        for proc_name in wanted:
            args = ["taskkill", "/IM", f"{proc_name}.exe", "/T"] + (["/F"] if force else [])
            try:
                run(args, timeout=20)
                closed.append(proc_name)
            except ActionError:
                continue
    elif SYSTEM == "mac" and not force:
        _, spec = resolve_app(name)
        app = (spec or {}).get("mac") or name
        run(["osascript", "-e", f'tell application "{app}" to quit'])
        closed.append(app)
    elif psutil is not None:
        for p in psutil.process_iter(["name"]):
            pname = norm(p.info.get("name") or "")
            if any(pname == w or pname.startswith(w) for w in wanted):
                try:
                    p.kill() if force else p.terminate()
                    closed.append(pname)
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue
    else:
        for w in wanted:
            try:
                run(["pkill", "-KILL" if force else "-TERM", "-x", w], timeout=10)
                closed.append(w)
            except ActionError:
                continue
    if not closed:
        raise ActionError(f"'{name}' is not running")
    return {"closed": key, "processes": sorted(set(closed)), "forced": force}


# ---------------------------------------------------------------------------------------------- windows (Win32)

if SYSTEM == "windows":
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    try:
        user32.SetProcessDPIAware()  # screenshot pixels == mouse coordinates
    except Exception:  # noqa: BLE001
        pass

    ULONG_PTR = ctypes.c_size_t

    class KEYBDINPUT(ctypes.Structure):
        _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD),
                    ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]

    class MOUSEINPUT(ctypes.Structure):
        _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD),
                    ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]

    class HARDWAREINPUT(ctypes.Structure):
        _fields_ = [("uMsg", wintypes.DWORD), ("wParamL", wintypes.WORD), ("wParamH", wintypes.WORD)]

    class _INPUTUNION(ctypes.Union):
        _fields_ = [("ki", KEYBDINPUT), ("mi", MOUSEINPUT), ("hi", HARDWAREINPUT)]

    class INPUT(ctypes.Structure):
        _fields_ = [("type", wintypes.DWORD), ("u", _INPUTUNION)]

    KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, KEYEVENTF_EXTENDED = 0x0002, 0x0004, 0x0001

    def _send(*inputs: INPUT) -> None:
        arr = (INPUT * len(inputs))(*inputs)
        if user32.SendInput(len(inputs), arr, ctypes.sizeof(INPUT)) != len(inputs):
            raise ActionError("input was blocked (is a higher-privilege window focused?)")

    def _vk(code: int, up: bool = False) -> INPUT:
        return INPUT(type=1, u=_INPUTUNION(ki=KEYBDINPUT(wVk=code, dwFlags=KEYEVENTF_KEYUP if up else 0)))

    def win_tap(code: int, times: int = 1) -> None:
        for _ in range(times):
            _send(_vk(code), _vk(code, up=True))

    def win_type(text: str) -> None:
        for ch in text.replace("\r\n", "\n"):
            if ch == "\n":
                win_tap(0x0D)
                continue
            for unit in [ch] if ord(ch) <= 0xFFFF else [chr(c) for c in _utf16(ch)]:
                code = ord(unit)
                _send(INPUT(type=1, u=_INPUTUNION(ki=KEYBDINPUT(wScan=code, dwFlags=KEYEVENTF_UNICODE))),
                      INPUT(type=1, u=_INPUTUNION(ki=KEYBDINPUT(wScan=code, dwFlags=KEYEVENTF_UNICODE | KEYEVENTF_KEYUP))))

    def _utf16(ch: str) -> list[int]:
        b = ch.encode("utf-16-le")
        return [int.from_bytes(b[i:i + 2], "little") for i in range(0, len(b), 2)]

    def win_windows() -> list[tuple[int, str]]:
        found: list[tuple[int, str]] = []
        proto = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

        def cb(hwnd, _):
            if user32.IsWindowVisible(hwnd):
                n = user32.GetWindowTextLengthW(hwnd)
                if n:
                    buf = ctypes.create_unicode_buffer(n + 1)
                    user32.GetWindowTextW(hwnd, buf, n + 1)
                    found.append((hwnd, buf.value))
            return True

        user32.EnumWindows(proto(cb), 0)
        return found

    def win_clipboard_get() -> str:
        CF_UNICODETEXT = 13
        user32.GetClipboardData.restype = wintypes.HANDLE
        kernel32.GlobalLock.restype = ctypes.c_void_p
        for _ in range(10):
            if user32.OpenClipboard(None):
                break
            time.sleep(0.05)
        else:
            raise ActionError("clipboard is busy")
        try:
            h = user32.GetClipboardData(CF_UNICODETEXT)
            if not h:
                return ""
            p = kernel32.GlobalLock(h)
            try:
                return ctypes.wstring_at(p)
            finally:
                kernel32.GlobalUnlock(h)
        finally:
            user32.CloseClipboard()

    def win_clipboard_set(text: str) -> None:
        CF_UNICODETEXT, GMEM_MOVEABLE = 13, 0x0002
        kernel32.GlobalAlloc.restype = wintypes.HGLOBAL
        kernel32.GlobalLock.restype = ctypes.c_void_p
        data = text.encode("utf-16-le") + b"\x00\x00"
        for _ in range(10):
            if user32.OpenClipboard(None):
                break
            time.sleep(0.05)
        else:
            raise ActionError("clipboard is busy")
        try:
            user32.EmptyClipboard()
            h = kernel32.GlobalAlloc(GMEM_MOVEABLE, len(data))
            p = kernel32.GlobalLock(h)
            ctypes.memmove(p, data, len(data))
            kernel32.GlobalUnlock(h)
            if not user32.SetClipboardData(CF_UNICODETEXT, h):
                raise ActionError("could not set the clipboard")
        finally:
            user32.CloseClipboard()


VK = {"ctrl": 0x11, "control": 0x11, "shift": 0x10, "alt": 0x12, "win": 0x5B, "cmd": 0x5B, "super": 0x5B,
      "enter": 0x0D, "return": 0x0D, "esc": 0x1B, "escape": 0x1B, "tab": 0x09, "space": 0x20, "backspace": 0x08,
      "delete": 0x2E, "del": 0x2E, "up": 0x26, "down": 0x28, "left": 0x25, "right": 0x27, "home": 0x24,
      "end": 0x23, "pageup": 0x21, "pagedown": 0x22, "insert": 0x2D, "printscreen": 0x2C,
      **{f"f{i}": 0x6F + i for i in range(1, 13)}}
XDO_KEYS = {"ctrl": "ctrl", "control": "ctrl", "shift": "shift", "alt": "alt", "win": "super", "cmd": "super",
            "super": "super", "enter": "Return", "return": "Return", "esc": "Escape", "escape": "Escape", "tab": "Tab",
            "space": "space", "backspace": "BackSpace", "delete": "Delete", "del": "Delete", "up": "Up",
            "down": "Down", "left": "Left", "right": "Right", "home": "Home", "end": "End", "pageup": "Prior",
            "pagedown": "Next", "insert": "Insert", "printscreen": "Print", **{f"f{i}": f"F{i}" for i in range(1, 13)}}
MEDIA_VK = {"play_pause": 0xB3, "play": 0xB3, "pause": 0xB3, "next": 0xB0, "previous": 0xB1, "stop": 0xB2}


# ---------------------------------------------------------------------------------------------- actions

def media_control(action: str) -> dict:
    if SYSTEM == "windows":
        win_tap(MEDIA_VK[action])
        return {"media": action, "via": "media key"}
    if SYSTEM == "mac":
        verb = {"play_pause": "playpause", "play": "play", "pause": "pause", "next": "next track",
                "previous": "previous track", "stop": "pause"}[action]
        for app in ("Spotify", "Music"):
            run(["osascript", "-e", f'if application "{app}" is running then tell application "{app}" to {verb}'],
                check=False)
        return {"media": action, "via": "Spotify/Music"}
    verb = {"play_pause": "play-pause", "play": "play", "pause": "pause", "next": "next", "previous": "previous",
            "stop": "stop"}[action]
    run(["playerctl", verb])
    return {"media": action, "via": "playerctl"}


def _win_volume_iface():
    try:
        import comtypes  # type: ignore
        from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume  # type: ignore
    except ImportError:
        return None
    comtypes.CoInitialize()
    dev = AudioUtilities.GetSpeakers()
    iface = getattr(dev, "EndpointVolume", None)
    if iface is None:
        from ctypes import POINTER, cast

        from comtypes import CLSCTX_ALL  # type: ignore
        iface = cast(dev.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None), POINTER(IAudioEndpointVolume))
    return iface


def _linux_volume() -> int:
    out = run(["pactl", "get-sink-volume", "@DEFAULT_SINK@"])
    m = re.search(r"(\d+)%", out)
    return int(m.group(1)) if m else -1


def volume_control(action: str, level: int | None = None, step: int = 10) -> dict:
    if SYSTEM == "windows":
        vol = _win_volume_iface()
        if vol is not None:
            if action == "set":
                vol.SetMasterVolumeLevelScalar(max(0, min(100, level or 0)) / 100, None)
                vol.SetMute(0, None)
            elif action in ("up", "down"):
                cur = round(vol.GetMasterVolumeLevelScalar() * 100)
                vol.SetMasterVolumeLevelScalar(max(0, min(100, cur + (step if action == "up" else -step))) / 100, None)
            elif action in ("mute", "unmute"):
                vol.SetMute(1 if action == "mute" else 0, None)
            return {"volume": round(vol.GetMasterVolumeLevelScalar() * 100), "muted": bool(vol.GetMute())}
        # no pycaw: the volume keys (2% per press)
        if action == "set":
            win_tap(0xAE, 50)
            win_tap(0xAF, round((level or 0) / 2))
            return {"volume": level, "via": "volume keys (approximate)"}
        if action in ("up", "down"):
            win_tap(0xAF if action == "up" else 0xAE, max(1, step // 2))
            return {"volume": None, "via": "volume keys"}
        if action in ("mute", "unmute"):
            win_tap(0xAD)
            return {"muted": action == "mute", "via": "mute key (toggle)"}
        raise ActionError("reading the volume needs the pycaw package")
    if SYSTEM == "mac":
        if action == "set":
            run(["osascript", "-e", f"set volume output volume {level}"])
        elif action in ("up", "down"):
            cur = int(run(["osascript", "-e", "output volume of (get volume settings)"]).strip() or 0)
            run(["osascript", "-e", f"set volume output volume {max(0, min(100, cur + (step if action == 'up' else -step)))}"])
        elif action in ("mute", "unmute"):
            run(["osascript", "-e", f"set volume output muted {'true' if action == 'mute' else 'false'}"])
        return {"volume": int(run(["osascript", "-e", "output volume of (get volume settings)"]).strip() or 0)}
    if action == "set":
        run(["pactl", "set-sink-volume", "@DEFAULT_SINK@", f"{level}%"])
        run(["pactl", "set-sink-mute", "@DEFAULT_SINK@", "0"])
    elif action in ("up", "down"):
        run(["pactl", "set-sink-volume", "@DEFAULT_SINK@", f"{'+' if action == 'up' else '-'}{step}%"])
    elif action in ("mute", "unmute"):
        run(["pactl", "set-sink-mute", "@DEFAULT_SINK@", "1" if action == "mute" else "0"])
    return {"volume": _linux_volume()}


def open_url(url: str) -> dict:
    if not re.match(r"^(https?://|spotify:)", url):
        raise ActionError("only http(s) and spotify: links are opened")
    if SYSTEM == "windows":
        os.startfile(url)  # type: ignore[attr-defined]  # noqa: S606
    elif SYSTEM == "mac":
        run(["open", url])
    else:
        spawn(["xdg-open", url])
    return {"opened": url}


def windows_control(action: str, title: str | None = None) -> dict:
    if SYSTEM == "windows":
        wins = win_windows()
        if action == "list":
            return {"windows": [t for _, t in wins][:60]}
        match = [(h, t) for h, t in wins if title and title.lower() in t.lower()]
        if not match:
            raise ActionError(f"no window with '{title}' in its title")
        hwnd, t = match[0]
        show = {"focus": 9, "restore": 9, "minimize": 6, "maximize": 3}[action]
        user32.ShowWindow(hwnd, show)
        if action in ("focus", "restore", "maximize"):
            user32.SetForegroundWindow(hwnd)
        return {"window": t, "action": action}
    if SYSTEM == "mac":
        if action == "list":
            out = run(["osascript", "-e", 'tell application "System Events" to get name of every process whose visible is true'])
            return {"windows": [x.strip() for x in out.split(",") if x.strip()]}
        if action in ("focus", "restore", "maximize"):
            run(["osascript", "-e", f'tell application "{title}" to activate'])
        else:
            run(["osascript", "-e", f'tell application "System Events" to set visible of process "{title}" to false'])
        return {"window": title, "action": action}
    if action == "list":
        out = run(["wmctrl", "-l"])
        return {"windows": [" ".join(line.split()[3:]) for line in out.splitlines() if line.strip()][:60]}
    if action in ("focus", "restore"):
        run(["wmctrl", "-a", title or ""])
    elif action == "minimize":
        run(["xdotool", "search", "--name", title or "", "windowminimize"])
    elif action == "maximize":
        run(["wmctrl", "-r", title or "", "-b", "add,maximized_vert,maximized_horz"])
    return {"window": title, "action": action}


def type_text(text: str) -> dict:
    if SYSTEM == "windows":
        win_type(text)
    elif SYSTEM == "mac":
        run(["osascript", "-e", 'on run argv\ntell application "System Events" to keystroke (item 1 of argv)\nend run', text])
    else:
        run(["xdotool", "type", "--delay", "8", "--", text], timeout=60)
    return {"typed_chars": len(text)}


def hotkey(keys: list[str]) -> dict:
    keys = [k.lower() for k in keys]
    if SYSTEM == "windows":
        codes = []
        for k in keys:
            if k in VK:
                codes.append(VK[k])
            elif len(k) == 1 and k.isalnum():
                codes.append(ord(k.upper()))
            else:
                raise ActionError(f"unknown key '{k}'")
        _send(*[_vk(c) for c in codes], *[_vk(c, up=True) for c in reversed(codes)])
    elif SYSTEM == "mac":
        mods = [{"ctrl": "control down", "control": "control down", "shift": "shift down", "alt": "option down",
                 "cmd": "command down", "win": "command down"}[k] for k in keys[:-1] if k in
                ("ctrl", "control", "shift", "alt", "cmd", "win")]
        key = keys[-1]
        using = f" using {{{', '.join(mods)}}}" if mods else ""
        codes = {"enter": 36, "return": 36, "esc": 53, "escape": 53, "tab": 48, "space": 49, "backspace": 51,
                 "delete": 117, "up": 126, "down": 125, "left": 123, "right": 124}
        stmt = f"key code {codes[key]}" if key in codes else f'keystroke "{key}"'
        run(["osascript", "-e", f'tell application "System Events" to {stmt}{using}'])
    else:
        combo = "+".join(XDO_KEYS.get(k, k) for k in keys)
        run(["xdotool", "key", combo])
    return {"pressed": "+".join(keys)}


def mouse(action: str, x: int | None = None, y: int | None = None, amount: int = 0) -> dict:
    if SYSTEM == "windows":
        if x is not None and y is not None:
            user32.SetCursorPos(int(x), int(y))
        flags = {"click": [(0x0002, 0), (0x0004, 0)], "double_click": [(0x0002, 0), (0x0004, 0)] * 2,
                 "right_click": [(0x0008, 0), (0x0010, 0)], "scroll": [(0x0800, amount * 120)], "move": []}[action]
        for f, data in flags:
            _send(INPUT(type=0, u=_INPUTUNION(mi=MOUSEINPUT(mouseData=data & 0xFFFFFFFF, dwFlags=f))))
        return {"mouse": action, "x": x, "y": y}
    if SYSTEM == "mac":
        raise ActionError("mouse control on macOS needs the 'cliclick' tool (not supported yet)")
    cmd = ["xdotool"]
    if x is not None and y is not None:
        cmd += ["mousemove", str(x), str(y)]
    cmd += {"click": ["click", "1"], "double_click": ["click", "--repeat", "2", "1"], "right_click": ["click", "3"],
            "scroll": ["click", "--repeat", str(abs(amount) or 1), "4" if amount >= 0 else "5"], "move": []}[action]
    run(cmd)
    return {"mouse": action, "x": x, "y": y}


def clipboard_get() -> dict:
    if SYSTEM == "windows":
        text = win_clipboard_get()
    elif SYSTEM == "mac":
        text = run(["pbpaste"])
    else:
        text = run(["xclip", "-selection", "clipboard", "-o"]) if shutil.which("xclip") else run(["wl-paste"])
    return {"text": text[:20000]}


def clipboard_set(text: str) -> dict:
    if SYSTEM == "windows":
        win_clipboard_set(text)
    elif SYSTEM == "mac":
        run(["pbcopy"], input_text=text)
    elif shutil.which("xclip"):
        run(["xclip", "-selection", "clipboard"], input_text=text)
    else:
        run(["wl-copy"], input_text=text)
    return {"set_chars": len(text)}


def screen_capture(max_width: int = 1600) -> dict:
    img = None
    try:
        from PIL import ImageGrab  # type: ignore

        img = ImageGrab.grab(all_screens=SYSTEM == "windows")
    except Exception:  # noqa: BLE001 — try the next method
        img = None
    if img is None:
        try:
            import mss  # type: ignore
            from PIL import Image  # type: ignore

            with mss.mss() as sct:
                shot = sct.grab(sct.monitors[0])
                img = Image.frombytes("RGB", shot.size, shot.rgb)
        except Exception as exc:  # noqa: BLE001
            raise ActionError(f"screenshot is not available on this computer ({type(exc).__name__})") from exc
    width, height = img.size
    scale = min(1.0, max_width / float(width))
    if scale < 1.0:
        img = img.resize((int(width * scale), int(height * scale)))
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG", optimize=True)
    return {"width": img.size[0], "height": img.size[1], "screen_width": width, "screen_height": height,
            "scale": round(scale, 4), "note": "multiply image coordinates by 1/scale for computer_mouse",
            "png_base64": base64.b64encode(buf.getvalue()).decode()}


def shell_run(command: str, timeout_s: int = 30) -> dict:
    kwargs: dict[str, Any] = {}
    if SYSTEM == "windows":
        kwargs["creationflags"] = 0x08000000
    try:
        r = subprocess.run(command, shell=True, capture_output=True, text=True, timeout=timeout_s,  # noqa: S602
                           encoding="utf-8", errors="replace", **kwargs)
    except subprocess.TimeoutExpired as exc:
        raise ActionError(f"command timed out after {timeout_s}s") from exc
    return {"exit_code": r.returncode, "stdout": r.stdout[-20000:], "stderr": r.stderr[-5000:]}


# ---------------------------------------------------------------------------------------------- capabilities

def detect_capabilities() -> dict[str, bool]:
    have = shutil.which
    caps = {
        "apps": True,
        "browser": True,
        "media": SYSTEM in ("windows", "mac") or bool(have("playerctl")),
        "volume": SYSTEM in ("windows", "mac") or bool(have("pactl")),
        "windows": SYSTEM in ("windows", "mac") or bool(have("wmctrl")),
        "input": SYSTEM == "windows" or SYSTEM == "mac" or bool(have("xdotool")),
        "clipboard": SYSTEM in ("windows", "mac") or bool(have("xclip") or have("wl-copy")),
        "screen": _can_screenshot(),
        "shell": True,
    }
    switches = {"apps": "JARVIS_ALLOW_APPS", "browser": "JARVIS_ALLOW_BROWSER", "media": "JARVIS_ALLOW_MEDIA",
                "volume": "JARVIS_ALLOW_VOLUME", "windows": "JARVIS_ALLOW_WINDOWS", "input": "JARVIS_ALLOW_INPUT",
                "clipboard": "JARVIS_ALLOW_CLIPBOARD", "screen": "JARVIS_ALLOW_SCREEN", "shell": "JARVIS_ALLOW_SHELL"}
    defaults = {"shell": False}
    return {c: ok and flag(switches[c], defaults.get(c, True)) for c, ok in caps.items()}


def _can_screenshot() -> bool:
    try:
        import PIL  # type: ignore  # noqa: F401
    except ImportError:
        return False
    return SYSTEM in ("windows", "mac") or bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))


ACTIONS: dict[str, tuple[str, Callable[..., dict]]] = {
    "apps.open": ("apps", lambda a: open_app(a["name"])),
    "apps.close": ("apps", lambda a: close_app(a["name"], bool(a.get("force")))),
    "browser.open": ("browser", lambda a: open_url(a["url"])),
    "media.control": ("media", lambda a: media_control(a["action"])),
    "volume.control": ("volume", lambda a: volume_control(a["action"], a.get("level"), int(a.get("step") or 10))),
    "windows.control": ("windows", lambda a: windows_control(a["action"], a.get("title"))),
    "input.type": ("input", lambda a: type_text(a["text"])),
    "input.hotkey": ("input", lambda a: hotkey(list(a["keys"]))),
    "input.mouse": ("input", lambda a: mouse(a["action"], a.get("x"), a.get("y"), int(a.get("amount") or 0))),
    "clipboard.get": ("clipboard", lambda a: clipboard_get()),
    "clipboard.set": ("clipboard", lambda a: clipboard_set(a.get("text") or "")),
    "screen.capture": ("screen", lambda a: screen_capture(int(a.get("max_width") or 1600))),
    "shell.run": ("shell", lambda a: shell_run(a["command"], int(a.get("timeout_s") or 30))),
}


# ---------------------------------------------------------------------------------------------- agent loop

class Agent:
    def __init__(self, url: str, token: str, name: str, *, on_unauthorized: Callable[[], None] | None = None):
        self.ws_url = re.sub(r"^http", "ws", url.rstrip("/")) + "/api/ws/device"
        self.token = token
        self.name = name
        self.caps = detect_capabilities()
        self.lock = asyncio.Lock()  # one action at a time: keyboard/mouse must never interleave
        self.on_unauthorized = on_unauthorized  # the desktop app signs the user out and shows the login window

    async def execute(self, call: dict) -> dict:
        action = call.get("action", "")
        if action not in ACTIONS:
            return {"ok": False, "error": f"unknown action {action}"}
        cap, fn = ACTIONS[action]
        if not self.caps.get(cap):
            return {"ok": False, "error": f"'{cap}' is disabled on this computer"}
        started = time.monotonic()
        async with self.lock:
            try:
                data = await asyncio.wait_for(asyncio.to_thread(fn, call.get("args") or {}), timeout=150)
                ok, error = True, None
            except ActionError as exc:
                data, ok, error = {}, False, str(exc)
            except asyncio.TimeoutError:
                data, ok, error = {}, False, "the action timed out"
            except Exception as exc:  # noqa: BLE001
                log.exception("action crashed")
                data, ok, error = {}, False, f"{type(exc).__name__}: {exc}"[:300]
        args_log = {k: (v if k not in ("text", "command") else f"<{len(str(v))} chars>")
                    for k, v in (call.get("args") or {}).items()}
        log.info("action=%s ok=%s ms=%d args=%s error=%s", action, ok, int((time.monotonic() - started) * 1000),
                 json.dumps(args_log, ensure_ascii=False), error)
        return {"ok": ok, "data": data, "error": error}

    async def _connect(self):
        import websockets  # type: ignore

        headers = {"Authorization": f"Bearer {self.token}"}
        try:
            return await websockets.connect(self.ws_url, additional_headers=headers, max_size=32 * 1024 * 1024,
                                            ping_interval=20)
        except TypeError:  # websockets < 14
            return await websockets.connect(self.ws_url, extra_headers=headers, max_size=32 * 1024 * 1024,
                                            ping_interval=20)

    async def session(self) -> None:
        ws = await self._connect()
        try:
            caps = [c for c, ok in self.caps.items() if ok]
            await ws.send(json.dumps({"type": "hello", "name": self.name, "platform": f"{SYSTEM} {platform.release()}",
                                      "capabilities": caps, "version": VERSION}))
            welcome = json.loads(await asyncio.wait_for(ws.recv(), timeout=15))
            if welcome.get("type") != "welcome":
                raise RuntimeError(f"unexpected reply: {welcome}")
            log.info("connected to %s as '%s' — capabilities: %s", self.ws_url, self.name, ", ".join(caps))

            async def heartbeat():
                while True:
                    await asyncio.sleep(20)
                    await ws.send(json.dumps({"type": "heartbeat"}))

            hb = asyncio.create_task(heartbeat())
            try:
                async for raw in ws:
                    msg = json.loads(raw)
                    if msg.get("type") == "call":
                        asyncio.create_task(self._answer(ws, msg))
            finally:
                hb.cancel()
        finally:
            await ws.close()

    async def _answer(self, ws, call: dict) -> None:
        result = await self.execute(call)
        await ws.send(json.dumps({"type": "result", "id": call["id"], **result}))

    async def run_forever(self) -> None:
        delay = 1.0
        while True:
            started = time.monotonic()
            try:
                await self.session()
            except Exception as exc:  # noqa: BLE001
                code = (getattr(exc, "code", None) or getattr(getattr(exc, "rcvd", None), "code", None)
                        or getattr(getattr(exc, "response", None), "status_code", None))
                # a revoked/unknown token is refused at the handshake (HTTP 403) or right after it (4401)
                if code in (4401, 401, 403):
                    log.error("the server rejected the device token (needs the 'computer' scope) — fix the token")
                    if self.on_unauthorized is not None:
                        self.on_unauthorized()
                        return
                    delay = 60.0
                elif code == 4402:
                    log.error("the JARVIS plan of this account does not allow (more) computers — see Settings → Account")
                    delay = 300.0
                else:
                    log.warning("disconnected: %s", exc)
            if time.monotonic() - started > 30:
                delay = 1.0
            await asyncio.sleep(delay)
            delay = min(delay * 2, 60.0)


def main() -> None:
    parser = argparse.ArgumentParser(description="JARVIS desktop agent")
    parser.add_argument("--config", type=Path, help="path to a .env file")
    parser.add_argument("--check", action="store_true", help="print capabilities and exit")
    parser.add_argument("--log", type=Path, help="log file (default: stderr)")
    args = parser.parse_args()
    load_env(args.config)
    logging.basicConfig(level=os.environ.get("JARVIS_LOG_LEVEL", "INFO"),
                        format="%(asctime)s %(levelname)s %(message)s",
                        filename=str(args.log) if args.log else None)
    caps = detect_capabilities()
    if args.check:
        print(json.dumps({"system": SYSTEM, "version": VERSION, "capabilities": caps}, indent=2))
        return
    url = os.environ.get("JARVIS_URL", "http://localhost")
    token = os.environ.get("JARVIS_DEVICE_TOKEN", "")
    if not token:
        sys.exit("JARVIS_DEVICE_TOKEN is not set — create a device token with the 'computer' scope in "
                 "JARVIS → Settings → Sessions and devices")
    name = os.environ.get("JARVIS_DEVICE_NAME") or socket.gethostname()
    asyncio.run(Agent(url, token, name).run_forever())


if __name__ == "__main__":
    main()
