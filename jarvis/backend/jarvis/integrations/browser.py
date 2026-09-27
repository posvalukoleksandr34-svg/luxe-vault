"""Browser automation through a Playwright server running in its own container.

The worker connects over WebSocket (`chromium.connect`), so the browser — and
anything a hostile page might do — lives outside the core containers, on a
network segment without access to Postgres/Redis. Each user gets one
persistent context (cookies survive between steps of a task) that is closed
after 15 minutes of inactivity.

Pages are represented to the model as a compact text snapshot with numbered
element refs ([12] button "Sign in"), which is far cheaper and more reliable
than screenshots for most tasks; screenshots remain available.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from typing import Any

from jarvis.security.ssrf import UnsafeURLError, assert_public_url
from jarvis.tools.base import ToolError

SNAPSHOT_JS = r"""
() => {
  const out = [];
  let n = 0;
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  document.querySelectorAll('[data-jref]').forEach(el => el.removeAttribute('data-jref'));
  const sel = 'a[href], button, input, textarea, select, [role=button], [role=link], [role=checkbox], [role=tab], [contenteditable=true]';
  for (const el of document.querySelectorAll(sel)) {
    if (!visible(el)) continue;
    n += 1; el.setAttribute('data-jref', String(n));
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag);
    const label = (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || el.name || el.title || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const type = el.type ? ` type=${el.type}` : '';
    out.push(`[${n}] ${role}${type} "${label}"`);
    if (n >= 150) break;
  }
  const text = (document.body ? document.body.innerText : '').replace(/\n{3,}/g, '\n\n').slice(0, 12000);
  return { title: document.title, url: location.href, elements: out, text };
}
"""


class BrowserPool:
    def __init__(self, ws_endpoint: str | None):
        self.ws_endpoint = ws_endpoint
        self._pw = None
        self._browser = None
        self._contexts: dict[uuid.UUID, tuple[Any, Any, float]] = {}
        self._lock = asyncio.Lock()

    @property
    def available(self) -> bool:
        return bool(self.ws_endpoint)

    async def _connect(self):
        if self._browser is not None and self._browser.is_connected():
            return self._browser
        try:
            from playwright.async_api import async_playwright
        except ImportError as exc:  # pragma: no cover - optional dependency
            raise ToolError("browser support not installed (pip install jarvis[browser])") from exc
        if self._pw is None:
            self._pw = await async_playwright().start()
        self._browser = await self._pw.chromium.connect(self.ws_endpoint, timeout=20000)
        return self._browser

    async def page(self, user_id: uuid.UUID):
        if not self.available:
            raise ToolError("browser service is not running (enable the `browser` compose profile)")
        async with self._lock:
            await self._reap()
            entry = self._contexts.get(user_id)
            if entry is None:
                browser = await self._connect()
                ctx = await browser.new_context(viewport={"width": 1280, "height": 900}, locale="ru-RU",
                                                accept_downloads=False)
                page = await ctx.new_page()
                entry = (ctx, page, time.monotonic())
            self._contexts[user_id] = (entry[0], entry[1], time.monotonic())
            return entry[1]

    async def _reap(self, idle_s: int = 900) -> None:
        now = time.monotonic()
        for uid, (ctx, _, last) in list(self._contexts.items()):
            if now - last > idle_s:
                self._contexts.pop(uid, None)
                try:
                    await ctx.close()
                except Exception:  # noqa: BLE001
                    pass

    async def open(self, user_id: uuid.UUID, url: str) -> dict[str, Any]:
        try:
            await assert_public_url(url)
        except UnsafeURLError as exc:
            raise ToolError(f"URL not allowed: {exc}") from exc
        page = await self.page(user_id)
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        return await self.snapshot(user_id)

    async def snapshot(self, user_id: uuid.UUID) -> dict[str, Any]:
        page = await self.page(user_id)
        data = await page.evaluate(SNAPSHOT_JS)
        return {"url": data["url"], "title": data["title"], "elements": data["elements"], "text": data["text"]}

    async def click(self, user_id: uuid.UUID, ref: int) -> dict[str, Any]:
        page = await self.page(user_id)
        loc = page.locator(f'[data-jref="{ref}"]')
        if await loc.count() == 0:
            raise ToolError(f"element [{ref}] not found — take a new snapshot")
        await loc.first.click(timeout=10000)
        await page.wait_for_load_state("domcontentloaded", timeout=15000)
        return await self.snapshot(user_id)

    async def type(self, user_id: uuid.UUID, ref: int, text: str, submit: bool) -> dict[str, Any]:
        page = await self.page(user_id)
        loc = page.locator(f'[data-jref="{ref}"]')
        if await loc.count() == 0:
            raise ToolError(f"element [{ref}] not found — take a new snapshot")
        await loc.first.fill(text, timeout=10000)
        if submit:
            await loc.first.press("Enter")
            await page.wait_for_load_state("domcontentloaded", timeout=15000)
        return await self.snapshot(user_id)

    async def screenshot(self, user_id: uuid.UUID) -> bytes:
        page = await self.page(user_id)
        return await page.screenshot(full_page=False, type="png")

    async def close(self) -> None:
        for ctx, _, _ in self._contexts.values():
            try:
                await ctx.close()
            except Exception:  # noqa: BLE001
                pass
        self._contexts.clear()
        if self._pw is not None:
            await self._pw.stop()
