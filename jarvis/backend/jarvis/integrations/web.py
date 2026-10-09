"""Web search (Tavily / Brave) and page fetching with SSRF protection and readable-text extraction.

When JARVIS_SEARCH_PROVIDER=anthropic (default) the model uses Anthropic's
server-side web search/fetch instead and these client tools are hidden.
"""

from __future__ import annotations

from typing import Any

import httpx
from bs4 import BeautifulSoup

from jarvis.security.ssrf import UnsafeURLError, assert_public_url
from jarvis.tools.base import ToolError

UA = "Mozilla/5.0 (compatible; JARVIS/0.1; personal assistant)"
MAX_BYTES = 3_000_000


async def search_tavily(key: str, query: str, limit: int) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post("https://api.tavily.com/search", json={
            "query": query, "max_results": limit, "search_depth": "advanced", "include_answer": False},
            headers={"Authorization": f"Bearer {key}"})
    if r.status_code >= 400:
        raise ToolError(f"search failed ({r.status_code})", retryable=r.status_code >= 500)
    return [{"title": i.get("title"), "url": i.get("url"), "snippet": (i.get("content") or "")[:500]}
            for i in r.json().get("results", [])]


async def search_brave(key: str, query: str, limit: int) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get("https://api.search.brave.com/res/v1/web/search", params={"q": query, "count": limit},
                             headers={"X-Subscription-Token": key, "Accept": "application/json"})
    if r.status_code >= 400:
        raise ToolError(f"search failed ({r.status_code})", retryable=r.status_code >= 500)
    return [{"title": i.get("title"), "url": i.get("url"), "snippet": (i.get("description") or "")[:500]}
            for i in r.json().get("web", {}).get("results", [])]


def html_to_text(html: str) -> tuple[str, str]:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "iframe", "form", "nav", "footer", "header", "aside"]):
        tag.decompose()
    title = (soup.title.string or "").strip() if soup.title and soup.title.string else ""
    main = soup.find("article") or soup.find("main") or soup.body or soup
    lines = [ln.strip() for ln in main.get_text("\n").splitlines()]
    text = "\n".join(ln for ln in lines if ln)
    return title, text


async def fetch_page(url: str, *, max_chars: int = 30000, transport: httpx.AsyncBaseTransport | None = None) -> dict[str, Any]:
    try:
        await assert_public_url(url)
    except UnsafeURLError as exc:
        raise ToolError(f"URL not allowed: {exc}") from exc
    async with httpx.AsyncClient(timeout=25, follow_redirects=False, headers={"User-Agent": UA},
                                 transport=transport) as client:
        current = url
        for _ in range(5):
            async with client.stream("GET", current) as r:
                if r.is_redirect:
                    nxt = str(r.next_request.url) if r.next_request else r.headers.get("location", "")
                    try:
                        await assert_public_url(nxt)
                    except UnsafeURLError as exc:
                        raise ToolError(f"redirect blocked: {exc}") from exc
                    current = nxt
                    continue
                if r.status_code >= 400:
                    raise ToolError(f"HTTP {r.status_code} for {current}", retryable=r.status_code >= 500)
                ctype = r.headers.get("content-type", "")
                chunks, size = [], 0
                async for chunk in r.aiter_bytes():
                    size += len(chunk)
                    if size > MAX_BYTES:
                        break
                    chunks.append(chunk)
                body = b"".join(chunks)
                break
        else:
            raise ToolError("too many redirects")
    if "html" in ctype or body.lstrip()[:15].lower().startswith((b"<!doctype", b"<html")):
        title, text = html_to_text(body.decode(r.encoding or "utf-8", errors="replace"))
    elif "pdf" in ctype:
        from jarvis.integrations.files import extract_text

        title, text = "", extract_text("doc.pdf", body)
    elif ctype.startswith("text/") or "json" in ctype:
        title, text = "", body.decode("utf-8", errors="replace")
    else:
        raise ToolError(f"unsupported content type {ctype or 'unknown'}")
    return {"url": current, "title": title, "content": text[:max_chars], "truncated": len(text) > max_chars}
