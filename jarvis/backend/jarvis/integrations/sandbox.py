"""Client for the command sandbox (separate container, no access to core services)."""

from __future__ import annotations

from typing import Any

import httpx

from jarvis.tools.base import ToolError


class SandboxClient:
    def __init__(self, url: str | None, token: str | None, transport: httpx.AsyncBaseTransport | None = None):
        self.url = (url or "").rstrip("/")
        self.token = token
        self.transport = transport

    @property
    def available(self) -> bool:
        return bool(self.url and self.token)

    async def exec(self, command: str, *, timeout_s: int = 60, workdir: str = "") -> dict[str, Any]:
        if not self.available:
            raise ToolError("sandbox is not running (enable the `sandbox` compose profile)")
        try:
            async with httpx.AsyncClient(timeout=timeout_s + 15, transport=self.transport) as client:
                r = await client.post(f"{self.url}/exec", json={"command": command, "timeout": timeout_s,
                                                                 "workdir": workdir},
                                      headers={"Authorization": f"Bearer {self.token}"})
        except httpx.HTTPError as exc:
            raise ToolError(f"sandbox unreachable: {exc}", retryable=True) from exc
        if r.status_code >= 400:
            raise ToolError(f"sandbox error {r.status_code}: {r.text[:300]}")
        return r.json()
