"""Client-side web tools.

Used when JARVIS_SEARCH_PROVIDER is tavily/brave, or on routes without provider-hosted
web tools (local models). With the default `anthropic` provider the model uses
Anthropic's server-side web_search/web_fetch and these are hidden automatically.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from jarvis.integrations.web import fetch_page, search_brave, search_tavily
from jarvis.tools.base import ToolContext, ToolError, tool


class SearchArgs(BaseModel):
    query: str = Field(min_length=2, max_length=400)
    limit: int = Field(6, ge=1, le=15)


@tool(name="web_search", description="Search the web. Returns titles, URLs and snippets.", activity="Ищу в интернете",
      untrusted_output=True, timeout_s=40, retries=1, requires=("search",))
async def web_search(ctx: ToolContext, args: SearchArgs) -> dict:
    provider = ctx.app.settings.search_provider
    if provider == "tavily":
        key = await ctx.app.secrets.get("tavily_api_key")
        return {"results": await search_tavily(key, args.query, args.limit)}
    if provider == "brave":
        key = await ctx.app.secrets.get("brave_api_key")
        return {"results": await search_brave(key, args.query, args.limit)}
    raise ToolError("no client-side search provider configured (set JARVIS_SEARCH_PROVIDER=tavily|brave)")


class FetchArgs(BaseModel):
    url: str = Field(description="http(s) URL")
    max_chars: int = Field(20000, ge=1000, le=80000)


@tool(name="web_fetch", description="Download a web page (or PDF) and return its readable text.",
      activity="Читаю страницу", untrusted_output=True, timeout_s=45, retries=1, requires=("fetch",))
async def web_fetch(ctx: ToolContext, args: FetchArgs) -> dict:
    return await fetch_page(args.url, max_chars=args.max_chars)
