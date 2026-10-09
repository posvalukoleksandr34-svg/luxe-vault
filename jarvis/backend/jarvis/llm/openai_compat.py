"""OpenAI chat-completions provider: OpenAI itself and *local* models (Ollama, vLLM, LM Studio).

Two instances are built in `core.container`:
  - `openai`        — api.openai.com, the brain when JARVIS_LLM_PROVIDER=openai
  - `openai_compat` — the optional `local` route (private/offline mode, or failover)
Converts the canonical Claude-shaped messages to chat-completions and back.
"""

from __future__ import annotations

import inspect
import json
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from jarvis.core.logging import log
from jarvis.llm.types import LLMError, LLMNotConfigured, LLMProvider, LLMRequest, LLMResponse, RouteConfig, TextCallback, Usage


def _text_of(content: Any) -> str:
    if isinstance(content, str):
        return content
    parts = []
    for b in content or []:
        if b.get("type") == "text":
            parts.append(b.get("text", ""))
        elif b.get("type") == "tool_result":
            parts.append(_text_of(b.get("content")))
    return "\n".join(p for p in parts if p)


def to_openai_messages(system: list[dict], messages: list[dict]) -> list[dict]:
    out: list[dict] = []
    sys_text = "\n\n".join(b.get("text", "") for b in system if b.get("type") == "text")
    if sys_text:
        out.append({"role": "system", "content": sys_text})
    for m in messages:
        role, content = m["role"], m["content"]
        if isinstance(content, str):
            out.append({"role": role, "content": content})
            continue
        if role == "assistant":
            text = "".join(b.get("text", "") for b in content if b.get("type") == "text")
            calls = [
                {
                    "id": b["id"],
                    "type": "function",
                    "function": {"name": b["name"], "arguments": json.dumps(b.get("input", {}), ensure_ascii=False)},
                }
                for b in content
                if b.get("type") == "tool_use"
            ]
            msg: dict[str, Any] = {"role": "assistant", "content": text or None}
            if calls:
                msg["tool_calls"] = calls
            out.append(msg)
        else:
            texts: list[str] = []
            images: list[dict] = []
            for b in content:
                if b.get("type") == "tool_result":
                    out.append({"role": "tool", "tool_call_id": b["tool_use_id"], "content": _text_of(b.get("content"))})
                    # chat-completions tool messages are text-only: images (screenshots) follow as a user part
                    for part in b.get("content") if isinstance(b.get("content"), list) else []:
                        src = part.get("source") or {}
                        if part.get("type") == "image" and src.get("type") == "base64":
                            images.append({"type": "image_url",
                                           "image_url": {"url": f"data:{src['media_type']};base64,{src['data']}"}})
                elif b.get("type") == "text":
                    texts.append(b.get("text", ""))
                elif b.get("type") == "image" and (b.get("source") or {}).get("type") == "base64":
                    src = b["source"]
                    images.append({"type": "image_url",
                                   "image_url": {"url": f"data:{src['media_type']};base64,{src['data']}"}})
            if images:
                out.append({"role": "user", "content": [{"type": "text", "text": "\n".join(texts)}, *images]})
            elif texts:
                out.append({"role": "user", "content": "\n".join(texts)})
    return out


def to_openai_tools(tools: list[dict]) -> list[dict]:
    return [
        {"type": "function", "function": {"name": t["name"], "description": t.get("description", ""),
                                          "parameters": t["input_schema"]}}
        for t in tools
        if "input_schema" in t
    ]


KeySource = str | None | Callable[[], Awaitable[str | None]]


class OpenAICompatProvider(LLMProvider):
    name = "openai_compat"

    def __init__(self, base_url: str | None, api_key: KeySource = None,
                 transport: httpx.AsyncBaseTransport | None = None, *, label: str = "local model",
                 require_key: bool = False, openai_params: bool = False):
        """`openai_params`: speak api.openai.com's dialect — max_completion_tokens (GPT-5 models reject
        max_tokens) and reasoning_effort from the route's `effort`. Local servers get the classic form."""
        self.base_url = (base_url or "").rstrip("/")
        self.api_key = api_key
        self.transport = transport
        self.label = label
        self.require_key = require_key
        self.openai_params = openai_params
        # Models that rejected `reasoning_effort` together with function tools on /chat/completions (e.g.
        # "Function tools with reasoning_effort are not supported for gpt-5.6-terra"): learned at runtime so
        # only the first request pays for the retry; models that accept the combination keep reasoning.
        self._no_effort_with_tools: set[str] = set()

    async def _key(self) -> str | None:
        key = self.api_key
        if callable(key):
            key = key()
            if inspect.isawaitable(key):
                key = await key
        return key or None

    def _drop_effort(self, status: int, detail: str, body: dict[str, Any], route: RouteConfig, tools: bool) -> bool:
        """A 400 about `reasoning_effort` → adjust the body for one retry. True if a retry makes sense."""
        effort = body.get("reasoning_effort")
        if status != 400 or effort in (None, "none") or "reasoning_effort" not in detail:
            return False
        if tools:  # the API's own advice: "use /v1/responses or set reasoning_effort to 'none'"
            self._no_effort_with_tools.add(route.model)
            body["reasoning_effort"] = "none"
        else:  # the model takes no reasoning effort at all
            body.pop("reasoning_effort")
        log.warning("llm.reasoning_effort_rejected", model=route.model, effort=effort, with_tools=tools)
        return True

    async def generate(self, route: RouteConfig, req: LLMRequest, *, on_text: TextCallback | None = None) -> LLMResponse:
        if not self.base_url:
            raise LLMNotConfigured("Local model endpoint is not configured (JARVIS_LOCAL_LLM_BASE_URL).")
        api_key = await self._key()
        if self.require_key and not api_key:
            raise LLMNotConfigured(
                "не задан ключ OpenAI API — добавьте его в Настройки → Ключи API или OPENAI_API_KEY в .env.")
        body: dict[str, Any] = {
            "model": route.model,
            "messages": to_openai_messages(req.system, req.messages),
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        limit = req.max_tokens or route.max_tokens
        if self.openai_params:
            body["max_completion_tokens"] = limit
            if route.effort:
                body["reasoning_effort"] = route.effort
        else:
            body["max_tokens"] = limit
        tools = to_openai_tools(req.tools)
        if tools:
            body["tools"] = tools
            if "reasoning_effort" in body and route.model in self._no_effort_with_tools:
                body["reasoning_effort"] = "none"
        if req.output_schema:
            body["response_format"] = {"type": "json_schema", "json_schema": {"name": "out", "schema": req.output_schema}}
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        text_parts: list[str] = []
        calls: dict[int, dict[str, Any]] = {}
        finish = "stop"
        usage = Usage()
        try:
            async with httpx.AsyncClient(timeout=route.timeout_s, transport=self.transport) as client:
                for attempt in range(2):
                    r = await client.send(client.build_request(
                        "POST", f"{self.base_url}/chat/completions", json=body, headers=headers), stream=True)
                    if r.status_code < 400:
                        break
                    detail = (await r.aread()).decode(errors="replace")[:500]
                    await r.aclose()
                    if attempt == 0 and self._drop_effort(r.status_code, detail, body, route, bool(tools)):
                        continue  # the error came before any output: nothing was streamed yet
                    retryable = r.status_code >= 500 or r.status_code == 429
                    raise LLMError(f"{self.label} error {r.status_code}: {detail}", retryable=retryable,
                                   status=r.status_code)
                try:
                    async for line in r.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if data == "[DONE]":
                            break
                        chunk = json.loads(data)
                        if chunk.get("usage"):
                            u = chunk["usage"]
                            cached = (u.get("prompt_tokens_details") or {}).get("cached_tokens") or 0
                            usage.input_tokens = (u.get("prompt_tokens") or 0) - cached
                            usage.cache_read_tokens = cached
                            usage.output_tokens = u.get("completion_tokens") or 0
                        for choice in chunk.get("choices", []):
                            delta = choice.get("delta") or {}
                            if delta.get("content"):
                                text_parts.append(delta["content"])
                                if on_text:
                                    await on_text(delta["content"])
                            for tc in delta.get("tool_calls") or []:
                                slot = calls.setdefault(tc.get("index", 0), {"id": None, "name": "", "args": ""})
                                slot["id"] = tc.get("id") or slot["id"]
                                fn = tc.get("function") or {}
                                slot["name"] += fn.get("name") or ""
                                slot["args"] += fn.get("arguments") or ""
                            if choice.get("finish_reason"):
                                finish = choice["finish_reason"]
                finally:
                    await r.aclose()
        except httpx.HTTPError as exc:
            raise LLMError(f"cannot reach {self.label}: {exc}", retryable=True) from exc

        content: list[dict[str, Any]] = []
        if text_parts:
            content.append({"type": "text", "text": "".join(text_parts)})
        for _, c in sorted(calls.items()):
            try:
                args = json.loads(c["args"] or "{}")
            except json.JSONDecodeError:
                args = {"_raw": c["args"]}
            content.append({"type": "tool_use", "id": c["id"] or f"toolu_{uuid.uuid4().hex[:20]}", "name": c["name"],
                            "input": args})
        stop = {"tool_calls": "tool_use", "length": "max_tokens"}.get(finish, "end_turn")
        if calls:
            stop = "tool_use"
        return LLMResponse(content=content, stop_reason=stop, usage=usage, model=route.model)
