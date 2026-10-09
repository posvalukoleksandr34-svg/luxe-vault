"""Tools for the user's own computer, executed by the desktop agent via `DeviceHub`.

Each tool maps to one agent action; the server never runs anything on the PC itself. Risk levels follow the
product policy: opening apps/sites, media and volume are low risk (autonomous); closing apps, typing, mouse,
clipboard and screenshots need confirmation; shell commands are HIGH (restricted + disabled on the agent by
default).
"""

from __future__ import annotations

from typing import Literal
from urllib.parse import quote_plus, urlparse

from pydantic import BaseModel, Field

from jarvis.devices.hub import DeviceError
from jarvis.tools.base import Risk, ToolContext, ToolError, tool

SEARCH_URLS = {
    "web": "https://www.google.com/search?q={q}",
    "youtube": "https://www.youtube.com/results?search_query={q}",
    "images": "https://www.google.com/search?tbm=isch&q={q}",
    "maps": "https://www.google.com/maps/search/{q}",
    "spotify": "spotify:search:{q}",
}


async def _call(ctx: ToolContext, action: str, args: dict | None = None, *, device: str | None = None,
                timeout_s: float = 20.0) -> dict:
    try:
        return await ctx.app.devices.call(ctx.user_id, action, args or {}, capability=action.split(".")[0],
                                          device=device, timeout_s=timeout_s)
    except DeviceError as exc:
        raise ToolError(str(exc)) from exc


class DeviceOnly(BaseModel):
    device: str | None = Field(None, description="Computer name, only if several are connected")


@tool(name="computer_status", description="Which of the user's computers are connected and what each allows.",
      activity="Проверяю компьютер")
async def computer_status(ctx: ToolContext, args: DeviceOnly) -> dict:
    devices = [d.public() for d in await ctx.app.devices.devices(ctx.user_id)]
    return {"connected": bool(devices), "devices": devices}


class AppArgs(DeviceOnly):
    name: str = Field(min_length=1, max_length=120, description="App name as a person says it: chrome, spotify, discord…")


@tool(name="computer_open_app", description="Launch an application on the user's computer.", risk=Risk.WRITE,
      activity="Запускаю приложение", requires=("computer.apps",), timeout_s=25)
async def computer_open_app(ctx: ToolContext, args: AppArgs) -> dict:
    return await _call(ctx, "apps.open", {"name": args.name}, device=args.device)


class CloseArgs(AppArgs):
    force: bool = Field(False, description="Kill without letting the app save (only if a normal close failed)")


@tool(name="computer_close_app", description="Close an application on the user's computer.", risk=Risk.WRITE,
      activity="Закрываю приложение", requires=("computer.apps",), timeout_s=25)
async def computer_close_app(ctx: ToolContext, args: CloseArgs) -> dict:
    return await _call(ctx, "apps.close", {"name": args.name, "force": args.force}, device=args.device)


class UrlArgs(DeviceOnly):
    url: str | None = Field(None, description="http(s) URL to open")
    search: str | None = Field(None, max_length=300, description="Search text (instead of url)")
    site: Literal["web", "youtube", "images", "maps", "spotify"] = "web"


@tool(name="computer_open_url", description="Open a website, or a web/YouTube/maps/Spotify search, in the user's "
      "own browser/app on their computer.", risk=Risk.WRITE, activity="Открываю в браузере",
      requires=("computer.browser",), timeout_s=20)
async def computer_open_url(ctx: ToolContext, args: UrlArgs) -> dict:
    if args.search:
        url = SEARCH_URLS[args.site].format(q=quote_plus(args.search))
    elif args.url:
        url = args.url.strip()
        if "://" not in url:
            url = "https://" + url
        if urlparse(url).scheme not in ("http", "https"):
            raise ToolError("only http(s) links can be opened")
    else:
        raise ToolError("give either url or search")
    return await _call(ctx, "browser.open", {"url": url}, device=args.device)


class MediaArgs(DeviceOnly):
    action: Literal["play_pause", "play", "pause", "next", "previous", "stop"]


@tool(name="computer_media", description="Media keys on the user's computer: play/pause, next, previous, stop "
      "(works for Spotify, YouTube, any player).", risk=Risk.WRITE, activity="Управляю воспроизведением",
      requires=("computer.media",), timeout_s=15)
async def computer_media(ctx: ToolContext, args: MediaArgs) -> dict:
    return await _call(ctx, "media.control", {"action": args.action}, device=args.device)


class VolumeArgs(DeviceOnly):
    action: Literal["set", "up", "down", "mute", "unmute", "get"]
    level: int | None = Field(None, ge=0, le=100, description="Percent, for action=set")
    step: int = Field(10, ge=1, le=50, description="Percent, for up/down")


@tool(name="computer_volume", description="System volume on the user's computer: set to a percent, up, down, "
      "mute, unmute or read it.", risk=Risk.WRITE, activity="Меняю громкость", requires=("computer.volume",),
      timeout_s=15)
async def computer_volume(ctx: ToolContext, args: VolumeArgs) -> dict:
    if args.action == "set" and args.level is None:
        raise ToolError("level is required for action=set")
    return await _call(ctx, "volume.control", args.model_dump(exclude={"device"}), device=args.device)


class WindowArgs(DeviceOnly):
    action: Literal["list", "focus", "minimize", "maximize", "restore"]
    title: str | None = Field(None, description="Part of the window title (not needed for list)")


@tool(name="computer_windows", description="List the open windows on the user's computer, or focus/minimize/"
      "maximize/restore one by title.", risk=Risk.WRITE, activity="Работаю с окнами",
      requires=("computer.windows",), timeout_s=15)
async def computer_windows(ctx: ToolContext, args: WindowArgs) -> dict:
    if args.action != "list" and not args.title:
        raise ToolError("title is required")
    return await _call(ctx, "windows.control", args.model_dump(exclude={"device"}), device=args.device)


class TypeArgs(DeviceOnly):
    text: str = Field(min_length=1, max_length=5000)


@tool(name="computer_type_text", description="Type text into the focused window on the user's computer.",
      risk=Risk.WRITE, activity="Печатаю текст", requires=("computer.input",), timeout_s=60)
async def computer_type_text(ctx: ToolContext, args: TypeArgs) -> dict:
    return await _call(ctx, "input.type", {"text": args.text}, device=args.device, timeout_s=60)


class HotkeyArgs(DeviceOnly):
    keys: list[str] = Field(min_length=1, max_length=5, description='e.g. ["ctrl", "t"], ["alt", "tab"], ["enter"]')


@tool(name="computer_hotkey", description="Press a key or key combination on the user's computer.",
      risk=Risk.WRITE, activity="Нажимаю клавиши", requires=("computer.input",), timeout_s=15)
async def computer_hotkey(ctx: ToolContext, args: HotkeyArgs) -> dict:
    return await _call(ctx, "input.hotkey", {"keys": [k.lower().strip() for k in args.keys]}, device=args.device)


class MouseArgs(DeviceOnly):
    action: Literal["move", "click", "double_click", "right_click", "scroll"]
    x: int | None = Field(None, ge=0, description="Screen x in pixels (from a screenshot)")
    y: int | None = Field(None, ge=0)
    amount: int = Field(0, ge=-50, le=50, description="Scroll steps (+ up, - down)")


@tool(name="computer_mouse", description="Move/click/scroll the mouse on the user's computer (coordinates from "
      "computer_screenshot).", risk=Risk.WRITE, activity="Управляю мышью", requires=("computer.input",),
      timeout_s=15)
async def computer_mouse(ctx: ToolContext, args: MouseArgs) -> dict:
    if args.action == "move" and (args.x is None or args.y is None):
        raise ToolError("x and y are required to move")
    return await _call(ctx, "input.mouse", args.model_dump(exclude={"device"}), device=args.device)


class ClipboardArgs(DeviceOnly):
    action: Literal["get", "set"]
    text: str | None = Field(None, max_length=20000)


@tool(name="computer_clipboard", description="Read or set the clipboard on the user's computer.", risk=Risk.WRITE,
      activity="Работаю с буфером обмена", requires=("computer.clipboard",), untrusted_output=True, timeout_s=15)
async def computer_clipboard(ctx: ToolContext, args: ClipboardArgs) -> dict:
    if args.action == "set" and args.text is None:
        raise ToolError("text is required for action=set")
    return await _call(ctx, "clipboard." + args.action, {"text": args.text or ""}, device=args.device)


@tool(name="computer_screenshot", description="Take a screenshot of the user's screen so you can see it "
      "(returns the image and its size; coordinates for computer_mouse are in these pixels).",
      activity="Смотрю на экран", requires=("computer.screen",), untrusted_output=True, timeout_s=30)
async def computer_screenshot(ctx: ToolContext, args: DeviceOnly) -> dict:
    data = await _call(ctx, "screen.capture", {"max_width": 1600}, device=args.device, timeout_s=30)
    b64 = data.pop("png_base64", None)
    if not b64:
        raise ToolError("the computer returned no image")
    data["_image"] = {"media_type": "image/png", "data": b64}
    return data


class RunArgs(DeviceOnly):
    command: str = Field(min_length=1, max_length=2000)
    timeout_s: int = Field(30, ge=1, le=120)


@tool(name="computer_run", description="Run a shell command on the user's computer and return its output. "
      "Only when the user explicitly asked for this exact command.", risk=Risk.HIGH, activity="Выполняю команду",
      requires=("computer.shell",), timeout_s=130)
async def computer_run(ctx: ToolContext, args: RunArgs) -> dict:
    return await _call(ctx, "shell.run", {"command": args.command, "timeout_s": args.timeout_s},
                       device=args.device, timeout_s=args.timeout_s + 10)
