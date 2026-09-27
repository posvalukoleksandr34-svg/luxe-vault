"""Browser tools backed by the isolated Playwright container."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from jarvis.tools.base import Risk, ToolContext, tool


def _fmt(snap: dict) -> dict:
    return {"url": snap["url"], "title": snap["title"], "elements": snap["elements"][:150],
            "text": snap["text"][:8000]}


class OpenArgs(BaseModel):
    url: str


@tool(name="browser_open", description="Open a URL in the browser and return a page snapshot with element refs.",
      activity="Открываю сайт", requires=("browser",), untrusted_output=True, timeout_s=60, parallel_safe=False)
async def browser_open(ctx: ToolContext, args: OpenArgs) -> dict:
    return _fmt(await ctx.app.browser.open(ctx.user_id, args.url))


class NoArgs(BaseModel):
    pass


@tool(name="browser_snapshot", description="Re-read the current page.", activity="Читаю страницу",
      requires=("browser",), untrusted_output=True, timeout_s=30, parallel_safe=False)
async def browser_snapshot(ctx: ToolContext, args: NoArgs) -> dict:
    return _fmt(await ctx.app.browser.snapshot(ctx.user_id))


class ClickArgs(BaseModel):
    ref: int = Field(description="Element number from the latest snapshot")


@tool(name="browser_click", description="Click an element by its ref.", risk=Risk.WRITE, activity="Нажимаю",
      requires=("browser",), untrusted_output=True, timeout_s=45, parallel_safe=False)
async def browser_click(ctx: ToolContext, args: ClickArgs) -> dict:
    return _fmt(await ctx.app.browser.click(ctx.user_id, args.ref))


class TypeArgs(BaseModel):
    ref: int
    text: str = Field(max_length=5000)
    submit: bool = False


@tool(name="browser_type", description="Type text into an input by ref (optionally press Enter).",
      risk=Risk.EXTERNAL, activity="Ввожу текст", requires=("browser",), untrusted_output=True, timeout_s=45,
      parallel_safe=False, summarize=lambda a: f"Ввести «{str(a.get('text'))[:80]}» в поле [{a.get('ref')}]")
async def browser_type(ctx: ToolContext, args: TypeArgs) -> dict:
    return _fmt(await ctx.app.browser.type(ctx.user_id, args.ref, args.text, args.submit))


@tool(name="browser_screenshot", description="Save a screenshot of the current page to the workspace.",
      activity="Делаю скриншот", requires=("browser",), timeout_s=30, parallel_safe=False)
async def browser_screenshot(ctx: ToolContext, args: NoArgs) -> dict:
    png = await ctx.app.browser.screenshot(ctx.user_id)
    rel = f"screenshots/{datetime.now().strftime('%Y%m%d-%H%M%S')}.png"
    info = ctx.app.files.write_bytes(rel, png)
    return {"path": info["path"], "size": info["size"]}
