"""Claude via the official Anthropic SDK (async, streaming)."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

import anthropic

from jarvis.llm.types import (
    LLMError,
    LLMNotConfigured,
    LLMProvider,
    LLMRequest,
    LLMResponse,
    RouteConfig,
    TextCallback,
    Usage,
)

# Models on the adaptive-thinking / effort API surface.
_MODERN_PREFIXES = (
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-fable-5",
    "claude-mythos-5",
    "claude-opus-4-8",
    "claude-opus-4-7",
    "claude-opus-4-6",
    "claude-sonnet-4-6",
)
_FALLBACK_BETA = "server-side-fallback-2026-07-01"
_CLIENT_ONLY_KEYS = {"parsed_output"}


def _is_modern(model: str) -> bool:
    return model.startswith(_MODERN_PREFIXES)


def _clean_block(block: Any) -> dict[str, Any]:
    data = block.to_dict(mode="json") if hasattr(block, "to_dict") else dict(block)
    for key in _CLIENT_ONLY_KEYS:
        data.pop(key, None)
    return data


class AnthropicProvider(LLMProvider):
    name = "anthropic"

    def __init__(self, api_key: Callable[[], Awaitable[str | None]], *, max_retries: int = 3):
        self._api_key = api_key
        self._max_retries = max_retries
        self._clients: dict[str, anthropic.AsyncAnthropic] = {}

    async def _client(self) -> anthropic.AsyncAnthropic:
        key = await self._api_key()
        if not key:
            raise LLMNotConfigured(
                "не задан ключ Anthropic API — добавьте его в Настройки → Ключи API или ANTHROPIC_API_KEY в .env."
            )
        client = self._clients.get(key)
        if client is None:
            client = anthropic.AsyncAnthropic(api_key=key, max_retries=self._max_retries)
            self._clients = {key: client}
        return client

    def build_params(self, route: RouteConfig, req: LLMRequest) -> tuple[dict[str, Any], list[str]]:
        params: dict[str, Any] = {
            "model": route.model,
            "max_tokens": req.max_tokens or route.max_tokens,
            "system": req.system,
            "messages": req.messages,
            # Automatic caching of the conversation tail; the system prompt carries its own breakpoint.
            "cache_control": {"type": "ephemeral"},
        }
        betas: list[str] = []
        if req.tools:
            tools = []
            for tool in req.tools:
                if route.eager_tool_streaming and "input_schema" in tool:
                    tool = {**tool, "eager_input_streaming": True}
                tools.append(tool)
            params["tools"] = tools
        output_config: dict[str, Any] = {}
        if _is_modern(route.model):
            if route.thinking == "adaptive":
                params["thinking"] = {"type": "adaptive"}
            if route.effort:
                output_config["effort"] = route.effort
        if req.output_schema:
            output_config["format"] = {"type": "json_schema", "schema": req.output_schema}
        if output_config:
            params["output_config"] = output_config
        if route.fallbacks == "default":
            params["fallbacks"] = "default"
            betas.append(_FALLBACK_BETA)
        return params, betas

    async def generate(
        self, route: RouteConfig, req: LLMRequest, *, on_text: TextCallback | None = None
    ) -> LLMResponse:
        client = await self._client()
        params, betas = self.build_params(route, req)
        if betas:
            params["betas"] = betas
        try:
            async with client.with_options(timeout=route.timeout_s).beta.messages.stream(**params) as stream:
                async for event in stream:
                    if event.type == "text" and on_text is not None and event.text:
                        await on_text(event.text)
                final = await stream.get_final_message()
        except anthropic.AuthenticationError as exc:
            raise LLMError("Anthropic rejected the API key", status=401) from exc
        except anthropic.PermissionDeniedError as exc:
            raise LLMError(f"Anthropic permission denied: {exc.message}", status=403) from exc
        except anthropic.NotFoundError as exc:
            raise LLMError(f"Unknown model or endpoint: {route.model}", status=404) from exc
        except anthropic.RateLimitError as exc:
            raise LLMError("Anthropic rate limit reached", retryable=True, status=429) from exc
        except anthropic.BadRequestError as exc:
            raise LLMError(f"Bad request to Anthropic: {exc.message}", status=400) from exc
        except anthropic.APIStatusError as exc:
            raise LLMError(
                f"Anthropic API error {exc.status_code}", retryable=exc.status_code >= 500, status=exc.status_code
            ) from exc
        except anthropic.APIConnectionError as exc:  # includes APITimeoutError
            raise LLMError("Cannot reach the Anthropic API", retryable=True) from exc
        except ValueError as exc:
            # Eager tool-input streaming: the model emitted JSON the SDK could not parse at all.
            raise LLMError(f"Malformed tool input JSON: {exc}", retryable=True) from exc

        usage = Usage(
            input_tokens=final.usage.input_tokens or 0,
            output_tokens=final.usage.output_tokens or 0,
            cache_read_tokens=getattr(final.usage, "cache_read_input_tokens", 0) or 0,
            cache_write_tokens=getattr(final.usage, "cache_creation_input_tokens", 0) or 0,
        )
        stop_details = None
        if getattr(final, "stop_details", None) is not None:
            stop_details = final.stop_details.to_dict(mode="json")
        return LLMResponse(
            content=[_clean_block(b) for b in final.content],
            stop_reason=final.stop_reason or "end_turn",
            usage=usage,
            model=final.model or route.model,
            request_id=getattr(final, "_request_id", None),
            stop_details=stop_details,
        )
