"""Small Windows integrations: autostart, single instance, opening the UI as an app window."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import webbrowser
from pathlib import Path

RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
VALUE = "JARVIS"
IS_WINDOWS = sys.platform == "win32"


def _exe_command() -> str:
    exe = Path(sys.executable if getattr(sys, "frozen", False) else sys.argv[0]).resolve()
    return f'"{exe}" --background'


def autostart_enabled() -> bool:
    if not IS_WINDOWS:
        return False
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
            winreg.QueryValueEx(key, VALUE)
            return True
    except OSError:
        return False


def set_autostart(enabled: bool) -> None:
    """Per-user "Run" entry (no admin rights). The installer sets the same value."""
    if not IS_WINDOWS:
        return
    import winreg

    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
        if enabled:
            winreg.SetValueEx(key, VALUE, 0, winreg.REG_SZ, _exe_command())
        else:
            try:
                winreg.DeleteValue(key, VALUE)
            except OSError:
                pass


_mutex = None


def single_instance() -> bool:
    """False if JARVIS is already running for this Windows user."""
    global _mutex
    if not IS_WINDOWS:
        return True
    import ctypes

    _mutex = ctypes.windll.kernel32.CreateMutexW(None, False, "Local\\JARVIS-desktop-app")
    return ctypes.windll.kernel32.GetLastError() != 183  # ERROR_ALREADY_EXISTS


def app_browser() -> str | None:
    candidates = [
        os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
    ]
    found = next((c for c in candidates if IS_WINDOWS and os.path.exists(c)), None)
    return found or shutil.which("msedge") or shutil.which("google-chrome") or shutil.which("chromium")


def open_app_window(url: str, size: str = "1280,720") -> None:
    """Edge/Chrome app mode: own window, no address bar or tabs. Falls back to the default browser."""
    browser = app_browser()
    if browser:
        flags = subprocess.CREATE_NO_WINDOW if IS_WINDOWS else 0
        subprocess.Popen([browser, f"--app={url}", f"--window-size={size}"], creationflags=flags)  # noqa: S603
    else:
        webbrowser.open(url)
