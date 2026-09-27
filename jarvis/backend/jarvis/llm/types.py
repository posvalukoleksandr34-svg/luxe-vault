"""Provider-neutral request/response types.

The canonical message format is the Claude Messages API shape (content blocks
as plain dicts). It is the richest of the common formats (thinking, server
tools, citations), so other providers convert to and from it.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

TextCallback = Callable[[str], Awaitable[None]]


@dataclass
class RouteConfig:
    name: str
    provider: str
    model: str
    max_tokens: int = 16000
    effort: str | None = None
    thinking: str | None = "adaptive"  # adaptive | none
    fallbacks: str | None = None  # "default" -> server-side refusal fallback
    eager_tool_streaming: bool = True
    server_tools: bool = True  # allow Anthropic-hosted web search/fetch on this route
    timeout_s: float = 600.0


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0

    def add(self, other: "Usage") -> None:
        self.input_tokens += other.input_tokens
        self.output_tokens += other.output_tokens
        self.cache_read_tokens += other.cache_read_tokens
        self.cache_write_tokens += other.cache_write_tokens


@dataclass
class LLMRequest:
    system: list[dict[str, Any]]
    messages: list[dict[str, Any]]
    tools: list[dict[str, Any]] = field(default_factory=list)
    max_tokens: int | None = None
    output_schema: dict[str, Any] | None = None  # structured output (JSON schema)


@dataclass
class LLMResponse:
    content: list[dict[str, Any]]
    stop_reason: str
    usage: Usage
    model: str
    request_id: str | None = None
    stop_details: dict[str, Any] | None = None
    cost_usd: float = 0.0

    @property
    def text(self) -> str:
        return "".join(b.get("text", "") for b in self.content if b.get("type") == "text")

    @property
    def tool_uses(self) -> list[dict[str, Any]]:
        return [b for b in self.content if b.get("type") == "tool_use"]


class LLMError(Exception):
    def __init__(self, message: str, *, retryable: bool = False, status: int | None = None):
        super().__init__(message)
        self.retryable = retryable
        self.status = status


class LLMNotConfigured(LLMError):
    pass


class LLMProvider:
    name: str = "base"

    async def generate(
        self, route: RouteConfig, req: LLMRequest, *, on_text: TextCallback | None = None
    ) -> LLMResponse:  # pragma: no cover - interface
        raise NotImplementedError
