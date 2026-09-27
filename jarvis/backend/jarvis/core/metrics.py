from __future__ import annotations

from prometheus_client import Counter, Gauge, Histogram

LLM_REQUESTS = Counter("jarvis_llm_requests_total", "LLM requests", ["route", "model", "status"])
LLM_TOKENS = Counter("jarvis_llm_tokens_total", "LLM tokens", ["model", "kind"])
LLM_COST = Counter("jarvis_llm_cost_usd_total", "Estimated LLM spend (USD)", ["model"])
LLM_LATENCY = Histogram(
    "jarvis_llm_latency_seconds", "LLM request latency", ["route"], buckets=(0.5, 1, 2, 4, 8, 16, 32, 64, 128)
)
TOOL_CALLS = Counter("jarvis_tool_calls_total", "Tool executions", ["tool", "status"])
TOOL_LATENCY = Histogram(
    "jarvis_tool_latency_seconds", "Tool latency", ["tool"], buckets=(0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120)
)
TASKS = Counter("jarvis_tasks_total", "Task terminal states", ["kind", "status"])
TASK_QUEUE = Gauge("jarvis_task_queue_depth", "Queued tasks")
APPROVALS = Counter("jarvis_approvals_total", "Approval decisions", ["tier", "status"])
HTTP_REQUESTS = Counter("jarvis_http_requests_total", "HTTP requests", ["method", "route", "status"])
HTTP_LATENCY = Histogram("jarvis_http_latency_seconds", "HTTP latency", ["route"])
MEMORY_OPS = Counter("jarvis_memory_ops_total", "Memory operations", ["op"])
