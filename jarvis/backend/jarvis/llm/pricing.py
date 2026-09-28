"""Per-model token prices (USD per 1M tokens) for cost tracking.

Cache writes are billed at 1.25x input (5-minute TTL) and cache reads at 0.1x.
Values are overridable from config/models.yaml -> pricing.
"""

from __future__ import annotations

from jarvis.llm.types import Usage

DEFAULT_PRICING: dict[str, dict[str, float]] = {
    "claude-opus-5": {"input": 5.0, "output": 25.0},
    "claude-opus-5-5": {"input": 4.0, "output": 20.0},
    "claude-fable-5-1": {"input": 10.0, "output": 50.0},
    "claude-sonnet-5": {"input": 2.0, "output": 10.0},
    "claude-haiku-4-5": {"input": 1.0, "output": 5.0},
    # OpenAI does not charge for cache writes; cached reads are 10% of input.
    "gpt-5.6-terra": {"input": 2.0, "output": 12.0, "cache_write": 2.0},
    "gpt-5.6-luna": {"input": 1.0, "output": 6.0, "cache_write": 1.0},
    "gpt-5.6-sol": {"input": 5.0, "output": 30.0, "cache_write": 5.0},
}


def cost_usd(model: str, usage: Usage, table: dict[str, dict[str, float]] | None = None) -> float:
    table = table or DEFAULT_PRICING
    price = table.get(model)
    if price is None:
        # unknown / local model: free unless configured
        return 0.0
    inp = price["input"] / 1_000_000
    out = price["output"] / 1_000_000
    cache_read = price.get("cache_read", price["input"] * 0.1) / 1_000_000
    cache_write = price.get("cache_write", price["input"] * 1.25) / 1_000_000
    return round(
        usage.input_tokens * inp
        + usage.output_tokens * out
        + usage.cache_read_tokens * cache_read
        + usage.cache_write_tokens * cache_write,
        6,
    )
