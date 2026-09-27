"""OpenAI-compatible chat-completions provider for *local* models (Ollama, vLLM, LM Studio).

Used by the optional `local` route (private/offline mode, or failover when the
cloud brain is unreachable). Converts the canonical Claude-shaped messages to
chat-completions and back.
"""

from __future__ import annotations

import json
import uuid
from typing import Any

import httpx

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
            texts = []
            for b in content:
                if b.get("type") == "tool_result":
                    out.append({"role": "tool", "tool_call_id": b["tool_use_id"], "content": _text_of(b.get("content"))})
                elif b.get("type") == "text":
                    texts.append(b.get("text", ""))
            if texts:
                out.append({"role": "user", "content": "\n".join(texts)})
    return out


def to_openai_tools(tools: list[dict]) -> list[dict]:
    return [
        {"type": "function", "function": {"name": t["name"], "description": t.get("description", ""),
                                          "parameters": t["input_schema"]}}
        for t in tools
        if "input_schema" in t
    ]


class OpenAICompatProvider(LLMProvider):
    name = "openai_compat"

    def __init__(self, base_url: str | None, api_key: str | None = None, transport: httpx.AsyncBaseTransport | None = None):
        self.base_url = (base_url or "").rstrip("/")
        self.api_key = api_key
        self.transport = transport

    async def generate(self, route: RouteConfig, req: LLMRequest, *, on_text: TextCallback | None = None) -> LLMResponse:
        if not self.base_url:
            raise LLMNotConfigured("Local model endpoint is not configured (JARVIS_LOCAL_LLM_BASE_URL).")
        body: dict[str, Any] = {
            "model": route.model,
            "messages": to_openai_messages(req.system, req.messages),
            "max_tokens": req.max_tokens or route.max_tokens,
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        tools = to_openai_tools(req.tools)
        if tools:
            body["tools"] = tools
        if req.output_schema:
            body["response_format"] = {"type": "json_schema", "json_schema": {"name": "out", "schema": req.output_schema}}
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        text_parts: list[str] = []
        calls: dict[int, dict[str, Any]] = {}
        finish = "stop"
        usage = Usage()
        try:
            async with httpx.AsyncClient(timeout=route.timeout_s, transport=self.transport) as client:
                async with client.stream("POST", f"{self.base_url}/chat/completions", json=body, headers=headers) as r:
                    if r.status_code >= 400:
                        detail = (await r.aread()).decode(errors="replace")[:500]
                        raise LLMError(f"local model error {r.status_code}: {detail}", retryable=r.status_code >= 500,
                                       status=r.status_code)
                    async for line in r.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if data == "[DONE]":
                            break
                        chunk = json.loads(data)
                        if chunk.get("usage"):
                            usage.input_tokens = chunk["usage"].get("prompt_tokens", 0)
                            usage.output_tokens = chunk["usage"].get("completion_tokens", 0)
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
        except httpx.HTTPError as exc:
            raise LLMError(f"cannot reach local model: {exc}", retryable=True) from exc

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
