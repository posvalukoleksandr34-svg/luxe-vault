import json

import httpx
import pytest

from jarvis.llm.anthropic_provider import AnthropicProvider
from jarvis.llm.fake import ScriptedProvider, text_response
from jarvis.llm.openai_compat import OpenAICompatProvider, to_openai_messages
from jarvis.llm.pricing import cost_usd
from jarvis.llm.router import BudgetExceeded, ModelRouter, load_routes
from jarvis.llm.types import LLMError, LLMNotConfigured, LLMRequest, RouteConfig, Usage


def test_anthropic_params_modern_model():
    p = AnthropicProvider(lambda: None)
    route = RouteConfig(name="main", provider="anthropic", model="claude-opus-5", effort="medium", fallbacks="default")
    req = LLMRequest(system=[{"type": "text", "text": "s"}], messages=[{"role": "user", "content": "hi"}],
                     tools=[{"name": "t", "description": "d", "input_schema": {"type": "object"}},
                            {"type": "web_search_20260209", "name": "web_search"}])
    params, betas = p.build_params(route, req)
    assert params["thinking"] == {"type": "adaptive"}
    assert params["output_config"] == {"effort": "medium"}
    assert params["fallbacks"] == "default" and betas == ["server-side-fallback-2026-07-01"]
    assert params["tools"][0]["eager_input_streaming"] is True
    assert "eager_input_streaming" not in params["tools"][1]  # server tools untouched
    assert params["cache_control"] == {"type": "ephemeral"}
    assert "temperature" not in params and "budget_tokens" not in json.dumps(params)


def test_anthropic_params_haiku_has_no_thinking_or_effort():
    p = AnthropicProvider(lambda: None)
    route = RouteConfig(name="fast", provider="anthropic", model="claude-haiku-4-5", thinking="none", effort="low")
    params, betas = p.build_params(route, LLMRequest(system=[], messages=[], output_schema={"type": "object"}))
    assert "thinking" not in params and betas == []
    assert params["output_config"] == {"format": {"type": "json_schema", "schema": {"type": "object"}}}


async def test_anthropic_without_key_is_not_configured():
    async def no_key():
        return None

    with pytest.raises(LLMNotConfigured):
        await AnthropicProvider(no_key).generate(RouteConfig(name="m", provider="anthropic", model="claude-opus-5"),
                                                 LLMRequest(system=[], messages=[]))


def test_cost():
    u = Usage(input_tokens=1_000_000, output_tokens=100_000, cache_read_tokens=1_000_000)
    assert cost_usd("claude-opus-5", u) == pytest.approx(5.0 + 2.5 + 0.5)
    assert cost_usd("qwen3:14b", u) == 0.0


def test_default_routes_load(tmp_path):
    routes, pricing, fallbacks = load_routes(tmp_path / "missing.yaml")
    assert routes["main"].model == "claude-opus-5"
    assert routes["fast"].model == "claude-haiku-4-5"
    assert routes["worker"].model == "claude-sonnet-5"
    assert fallbacks["main"] == "local"


async def test_router_records_cost_and_enforces_budget():
    records = []

    async def rec(r):
        records.append(r)

    spent = {"v": 0.0}

    async def spend():
        return spent["v"]

    routes, pricing, _ = load_routes(None)
    router = ModelRouter(routes, {"anthropic": ScriptedProvider([text_response("hi"), text_response("again")])},
                         recorder=rec, spend_today=spend, daily_limit_usd=1.0)
    resp = await router.generate("main", LLMRequest(system=[], messages=[]))
    assert resp.text == "hi" and records[0].status == "ok" and records[0].model == "scripted"
    spent["v"] = 1.5
    with pytest.raises(BudgetExceeded):
        await router.generate("main", LLMRequest(system=[], messages=[]))


async def test_router_falls_back_to_local_when_brain_unconfigured():
    class Down(ScriptedProvider):
        async def generate(self, route, req, *, on_text=None):
            raise LLMNotConfigured("no key")

    local = OpenAICompatProvider("http://ollama:11434/v1", transport=httpx.MockTransport(lambda r: httpx.Response(
        200, text='data: {"choices":[{"delta":{"content":"local ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n')))
    routes, _, fallbacks = load_routes(None)
    router = ModelRouter(routes, {"anthropic": Down([]), "openai_compat": local}, fallbacks=fallbacks)
    resp = await router.generate("main", LLMRequest(system=[], messages=[{"role": "user", "content": "x"}]))
    assert resp.text == "local ok"


async def test_openai_compat_tool_calls_stream():
    chunks = [
        {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call_1", "function": {"name": "time_now", "arguments": ""}}]}}]},
        {"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": "{}"}}]}, "finish_reason": "tool_calls"}]},
        {"choices": [], "usage": {"prompt_tokens": 12, "completion_tokens": 3}},
    ]
    body = "".join(f"data: {json.dumps(c)}\n\n" for c in chunks) + "data: [DONE]\n\n"
    prov = OpenAICompatProvider("http://x/v1", transport=httpx.MockTransport(lambda r: httpx.Response(200, text=body)))
    resp = await prov.generate(RouteConfig(name="local", provider="openai_compat", model="m"),
                               LLMRequest(system=[], messages=[{"role": "user", "content": "time?"}],
                                          tools=[{"name": "time_now", "description": "", "input_schema": {"type": "object"}}]))
    assert resp.stop_reason == "tool_use"
    assert resp.tool_uses[0]["name"] == "time_now" and resp.usage.input_tokens == 12


def test_openai_message_conversion():
    msgs = to_openai_messages([{"type": "text", "text": "sys"}], [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": [{"type": "thinking", "thinking": ""}, {"type": "text", "text": "calling"},
                                          {"type": "tool_use", "id": "t1", "name": "f", "input": {"a": 1}}]},
        {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "42"}]},
    ])
    assert msgs[0] == {"role": "system", "content": "sys"}
    assert msgs[2]["tool_calls"][0]["function"]["arguments"] == '{"a": 1}'
    assert msgs[3] == {"role": "tool", "tool_call_id": "t1", "content": "42"}


async def test_llm_error_retryable_flag():
    err = LLMError("x", retryable=True)
    assert err.retryable


def test_demo_time_parser_removes_whole_phrase():
    from datetime import datetime

    from jarvis.llm.fake import parse_when

    now = datetime(2026, 9, 27, 12, 0)
    when, rest = parse_when("Напомни через 1 минуту проверить почту", now)
    assert when == datetime(2026, 9, 27, 12, 1) and "уту" not in rest and "проверить почту" in rest
    when, rest = parse_when("remind me in 2 hours to call mom", now)
    assert when == datetime(2026, 9, 27, 14, 0) and "hours" not in rest
    when, _ = parse_when("завтра в 10 купить молоко", now)
    assert when == datetime(2026, 9, 28, 10, 0)
