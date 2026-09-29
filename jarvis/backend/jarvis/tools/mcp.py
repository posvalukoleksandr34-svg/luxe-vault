"""MCP integration: tools from any Model Context Protocol server become JARVIS tools.

Servers are declared in config/mcp.yaml or added in the UI (mcp_servers table):

    servers:
      - name: github
        transport: http
        url: https://api.githubcopilot.com/mcp/
        headers: {Authorization: "Bearer ${GITHUB_TOKEN}"}
        default_risk: external
      - name: filesystem
        transport: stdio
        command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/data/files"]
        default_risk: write

Every MCP tool is registered as `mcp__<server>__<tool>` with the server's JSON
schema and the server's default risk (external → requires confirmation by
default), so MCP tools flow through the same permission gate, audit log,
timeouts and rate limits as native tools.
"""

from __future__ import annotations

import os
import re
from contextlib import AsyncExitStack
from pathlib import Path
from typing import TYPE_CHECKING, Any

import yaml

from jarvis.core.logging import log
from jarvis.tools.base import Risk, ToolContext, ToolError, ToolSpec

if TYPE_CHECKING:  # pragma: no cover
    from jarvis.core.container import AppContext

_ENV = re.compile(r"\$\{([A-Z0-9_]+)\}")


def _expand(value: Any) -> Any:
    if isinstance(value, str):
        return _ENV.sub(lambda m: os.environ.get(m.group(1), ""), value)
    if isinstance(value, dict):
        return {k: _expand(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_expand(v) for v in value]
    return value


def _safe(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]", "_", name)


class McpManager:
    def __init__(self, app: "AppContext"):
        self.app = app
        self._stack: AsyncExitStack | None = None
        self.clients: dict[str, Any] = {}
        self.status: dict[str, dict[str, Any]] = {}

    def load_config(self) -> list[dict[str, Any]]:
        path: Path = self.app.settings.config_dir / "mcp.yaml"
        if not path.exists():
            return []
        raw = yaml.safe_load(path.read_text()) or {}
        return [_expand(s) for s in raw.get("servers", []) if s.get("enabled", True)]

    async def start(self) -> None:
        servers = self.load_config()
        if not servers:
            return
        from mcp import Client, StdioServerParameters
        from mcp.client.streamable_http import create_mcp_http_client, streamable_http_client

        self._stack = AsyncExitStack()
        for cfg in servers:
            name = _safe(cfg["name"])
            try:
                if cfg.get("transport", "http") == "stdio":
                    cmd = cfg["command"]
                    target: Any = StdioServerParameters(command=cmd[0], args=cmd[1:], env=cfg.get("env"))
                else:
                    target = streamable_http_client(cfg["url"],
                                                    http_client=create_mcp_http_client(headers=cfg.get("headers")))
                client = await self._stack.enter_async_context(Client(target, read_timeout_seconds=60))
                listed = await client.list_tools()
                risk = Risk(cfg.get("default_risk", "external"))
                count = 0
                for t in listed.tools:
                    spec = self._spec(name, client, t, risk, cfg)
                    self.app.registry.register(spec, replace=True)
                    count += 1
                self.clients[name] = client
                self.status[name] = {"ok": True, "tools": count}
                log.info("mcp.connected", server=name, tools=count)
            except Exception as exc:  # noqa: BLE001 - one bad server must not block the others
                self.status[name] = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
                log.warning("mcp.connect_failed", server=name, error=str(exc))
        await self.app.secrets.set_setting("mcp_status", self.status)

    def _spec(self, server: str, client: Any, t: Any, risk: Risk, cfg: dict[str, Any]) -> ToolSpec:
        tool_name = t.name

        async def call(ctx: ToolContext, args: dict[str, Any]) -> Any:
            result = await client.call_tool(tool_name, args)
            parts = []
            for block in result.content or []:
                text = getattr(block, "text", None)
                parts.append(text if text is not None else f"[{getattr(block, 'type', 'content')}]")
            if getattr(result, "isError", False) or getattr(result, "is_error", False):
                raise ToolError("\n".join(parts)[:2000] or "MCP tool error")
            structured = getattr(result, "structuredContent", None) or getattr(result, "structured_content", None)
            return structured if structured else "\n".join(parts)

        schema = getattr(t, "inputSchema", None) or getattr(t, "input_schema", None) or {"type": "object"}
        overrides = (cfg.get("tools") or {}).get(tool_name, {})
        return ToolSpec(
            name=f"mcp__{server}__{_safe(tool_name)}"[:64],
            description=(t.description or f"{tool_name} from MCP server {server}")[:1024],
            fn=call,
            raw_input_schema=schema,
            risk=Risk(overrides.get("risk", risk.value)),
            activity=f"MCP: {server}",
            timeout_s=float(cfg.get("timeout_s", 60)),
            untrusted_output=True,
            parallel_safe=False,
            source="mcp",
            skill=f"mcp:{server}",
        )

    async def stop(self) -> None:
        if self._stack is not None:
            await self._stack.aclose()
            self._stack = None
