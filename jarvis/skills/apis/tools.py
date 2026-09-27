"""Generic REST connectors: add an API by editing config/connectors.yaml — no code, no core changes.

connectors:
  - name: home_assistant
    base_url: http://homeassistant.local:8123/api
    description: Smart home. GET states/<entity_id>; POST services/<domain>/<service> {"entity_id": ...}
    auth: {type: bearer, env: HOME_ASSISTANT_TOKEN}
    allow: ["states*", "services/light/*", "services/climate/*"]
    allow_private_network: true      # explicit opt-in for LAN services
"""

from __future__ import annotations

import fnmatch
import os
from typing import Any, Literal

import httpx
import yaml
from pydantic import BaseModel, Field

from jarvis.security.ssrf import UnsafeURLError, assert_public_url
from jarvis.tools.base import Risk, ToolContext, ToolError, tool


def load_connectors(ctx: ToolContext) -> dict[str, dict[str, Any]]:
    path = ctx.app.settings.config_dir / "connectors.yaml"
    if not path.exists():
        return {}
    raw = yaml.safe_load(path.read_text()) or {}
    return {c["name"]: c for c in raw.get("connectors", []) if c.get("name") and c.get("base_url")}


async def _request(ctx: ToolContext, name: str, method: str, path: str, body: Any = None,
                   params: dict | None = None) -> Any:
    conns = load_connectors(ctx)
    conn = conns.get(name)
    if conn is None:
        raise ToolError(f"unknown connector {name!r}", hint="available: " + ", ".join(sorted(conns)) or "none")
    path = path.lstrip("/")
    if ".." in path or not any(fnmatch.fnmatchcase(path, pat) for pat in conn.get("allow", ["*"])):
        raise ToolError(f"path {path!r} is not allowed for {name}")
    url = f"{conn['base_url'].rstrip('/')}/{path}"
    if not conn.get("allow_private_network"):
        try:
            await assert_public_url(url)
        except UnsafeURLError as exc:
            raise ToolError(f"URL not allowed: {exc}") from exc
    headers = dict(conn.get("headers") or {})
    auth = conn.get("auth") or {}
    secret = os.environ.get(auth.get("env", ""), "") if auth.get("env") else auth.get("value", "")
    if auth.get("type") == "bearer" and secret:
        headers["Authorization"] = f"Bearer {secret}"
    elif auth.get("type") == "header" and secret:
        headers[auth.get("name", "X-API-Key")] = secret
    async with httpx.AsyncClient(timeout=float(conn.get("timeout_s", 20))) as client:
        r = await client.request(method, url, json=body, params=params, headers=headers)
    if r.status_code >= 400:
        raise ToolError(f"{name} returned {r.status_code}: {r.text[:300]}", retryable=r.status_code >= 500)
    try:
        return r.json()
    except ValueError:
        return r.text[:20000]


class NoArgs(BaseModel):
    pass


@tool(name="api_list", description="List registered external API connectors and how to use them.",
      activity="Смотрю подключённые API")
async def api_list(ctx: ToolContext, args: NoArgs) -> dict:
    return {"connectors": [{"name": c["name"], "description": c.get("description", ""), "allow": c.get("allow", ["*"])}
                           for c in load_connectors(ctx).values()]}


class GetArgs(BaseModel):
    connector: str
    path: str
    params: dict[str, str] = Field(default_factory=dict)


@tool(name="api_get", description="GET a path on a registered API connector.", activity="Запрашиваю API",
      untrusted_output=True, timeout_s=30, retries=1)
async def api_get(ctx: ToolContext, args: GetArgs) -> Any:
    return await _request(ctx, args.connector, "GET", args.path, params=args.params)


class CallArgs(BaseModel):
    connector: str
    method: Literal["POST", "PUT", "PATCH", "DELETE"]
    path: str
    body: dict[str, Any] | list[Any] | None = None


@tool(name="api_call", description="Send a state-changing request (POST/PUT/PATCH/DELETE) to a registered API.",
      risk=Risk.EXTERNAL, activity="Вызываю API", untrusted_output=True, idempotent=False, timeout_s=30,
      summarize=lambda a: f"{a.get('method')} {a.get('connector')}/{a.get('path')}")
async def api_call(ctx: ToolContext, args: CallArgs) -> Any:
    return await _request(ctx, args.connector, args.method, args.path, body=args.body)
