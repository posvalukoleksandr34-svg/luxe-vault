"""JARVIS desktop app — entry point of the installed JARVIS.exe.

    first start      → sign-in window → device token saved in Windows Credential Manager
    every start      → tray icon only (no window): computer control + "Hey Jarvis" in the background
    "Hey Jarvis …"   → the phrase goes to the JARVIS server, the answer is spoken through the speakers
    tray menu        → open JARVIS (signed-in app window) · listen for "Hey Jarvis" · start with Windows ·
                       sign out · quit

`--background` (used by autostart) never opens a window unless the user must sign in.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import socket
import sys
import threading
from pathlib import Path

# the agent and the satellite are plain modules next to this package (bundled by PyInstaller)
ROOT = Path(__file__).resolve().parent.parent
for extra in (ROOT, ROOT.parent / "satellite"):
    if str(extra) not in sys.path:
        sys.path.append(str(extra))

from app import __version__, api, credentials, windows  # noqa: E402
from app.config import APP_NAME, SERVER_URL, data_dir, resource  # noqa: E402

log = logging.getLogger("jarvis.app")
SETTINGS = data_dir() / "app-settings.txt"  # one flag per line: "wake=off"


def _wake_enabled() -> bool:
    try:
        return "wake=off" not in SETTINGS.read_text()
    except OSError:
        return True


def _save_wake(enabled: bool) -> None:
    SETTINGS.write_text("wake=on\n" if enabled else "wake=off\n")


class Runtime:
    """Background asyncio loop: desktop agent (computer control) + voice satellite (wake word)."""

    def __init__(self, token: str, on_signed_out, notify):  # noqa: ANN001 - callbacks
        self.token = token
        self.on_signed_out = on_signed_out
        self.notify = notify
        self.loop = asyncio.new_event_loop()
        self.satellite = None
        self.wake_error: str | None = None
        self.thread = threading.Thread(target=self._run, name="jarvis-runtime", daemon=True)

    def start(self) -> None:
        self.thread.start()

    def _run(self) -> None:
        asyncio.set_event_loop(self.loop)
        self.loop.run_until_complete(self._main())

    async def _main(self) -> None:
        import jarvis_desktop

        agent = jarvis_desktop.Agent(SERVER_URL, self.token, socket.gethostname(),
                                     on_unauthorized=self.on_signed_out)
        tasks = [asyncio.create_task(agent.run_forever(), name="agent")]
        try:
            from jarvis_satellite import Satellite

            self.satellite = Satellite(SERVER_URL, self.token, on_event=self._voice_event)
            if not _wake_enabled():
                self.satellite.paused.set()
            tasks.append(asyncio.create_task(self.satellite.run(), name="voice"))
        except Exception as exc:  # noqa: BLE001 — no microphone / model: computer control still works
            self.wake_error = f"{type(exc).__name__}: {exc}"[:200]
            log.warning("wake word unavailable: %s", self.wake_error)
        await asyncio.gather(*tasks, return_exceptions=True)

    def _voice_event(self, kind: str, text: str = "") -> None:
        if kind == "wake":
            self.notify("Слушаю…")
        elif kind == "error" and text:
            self.notify(text[:200])

    def set_wake(self, enabled: bool) -> None:
        if self.satellite is not None:
            (self.satellite.paused.clear if enabled else self.satellite.paused.set)()

    def stop(self) -> None:
        self.loop.call_soon_threadsafe(self.loop.stop)


def run_tray(token: str) -> str:
    """Blocks until the user quits ("quit") or signs out / the token is revoked ("signed_out")."""
    import pystray
    from PIL import Image

    outcome = {"value": "quit"}
    icon_ref: dict = {}

    def notify(message: str) -> None:
        icon = icon_ref.get("icon")
        if icon is not None and icon.HAS_NOTIFICATION:
            try:
                icon.notify(message, APP_NAME)
            except Exception:  # noqa: BLE001 — notifications are best effort
                pass

    def signed_out() -> None:
        outcome["value"] = "signed_out"
        credentials.delete_token()
        icon_ref["icon"].stop()

    runtime = Runtime(token, signed_out, notify)

    def open_ui(path: str = "/widget"):
        def action(_icon=None, _item=None) -> None:  # noqa: ANN001 - pystray signature
            url = api.handoff_url(token, path)
            if url is None:
                notify("Не удалось открыть JARVIS: сервер недоступен или вход устарел.")
                return
            windows.open_app_window(url, "1280,720" if path == "/widget" else "1400,900")
        return action

    def toggle_wake(_icon, item) -> None:  # noqa: ANN001
        enabled = not item.checked
        _save_wake(enabled)
        runtime.set_wake(enabled)

    def toggle_autostart(_icon, item) -> None:  # noqa: ANN001
        windows.set_autostart(not item.checked)

    def sign_out(_icon, _item) -> None:  # noqa: ANN001
        api.logout(token)  # revoke this computer's token on the server too
        signed_out()

    def quit_app(icon, _item) -> None:  # noqa: ANN001
        icon.stop()

    wake_label = "Слушать «Hey Jarvis»"
    menu = pystray.Menu(
        pystray.MenuItem("Открыть JARVIS", open_ui("/widget"), default=True),
        pystray.MenuItem("Полный интерфейс", open_ui("/")),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem(wake_label, toggle_wake, checked=lambda _i: _wake_enabled()),
        pystray.MenuItem("Запускать вместе с Windows", toggle_autostart,
                         checked=lambda _i: windows.autostart_enabled(), visible=windows.IS_WINDOWS),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Выйти из аккаунта", sign_out),
        pystray.MenuItem("Закрыть JARVIS", quit_app),
    )
    image = Image.open(resource("jarvis.ico"))
    icon = pystray.Icon("jarvis", image, f"{APP_NAME} {__version__}", menu)
    icon_ref["icon"] = icon

    def setup(ic) -> None:  # noqa: ANN001
        ic.visible = True
        runtime.start()
        if runtime.wake_error:
            notify("«Hey Jarvis» недоступен: нет микрофона или модели. Управление компьютером работает.")

    icon.run(setup=setup)
    runtime.stop()
    return outcome["value"]


def main() -> None:
    parser = argparse.ArgumentParser(description="JARVIS desktop app")
    parser.add_argument("--background", action="store_true", help="start in the tray (autostart)")
    parser.add_argument("--sign-out", action="store_true", help="forget the saved sign-in and exit")
    args = parser.parse_args()
    logging.basicConfig(filename=str(data_dir() / "app.log"), level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s %(message)s")
    log.info("start version=%s server=%s", __version__, SERVER_URL)  # never the token
    if args.sign_out:
        credentials.delete_token()
        return
    if not windows.single_instance():
        return  # already running in the tray
    while True:
        token = credentials.load_token()
        if token and api.token_valid(token) is False:  # revoked/expired (None = offline: keep it)
            credentials.delete_token()
            token = None
        if not token:
            from app.login_window import ask_login

            token = ask_login()
            if not token:
                return  # closed the sign-in window
            credentials.save_token(token)
            if windows.IS_WINDOWS and not windows.autostart_enabled():
                windows.set_autostart(True)
        if run_tray(token) != "signed_out":
            return


if __name__ == "__main__":
    main()
