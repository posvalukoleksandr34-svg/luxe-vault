"""Tool contract.

A tool is a typed async function plus metadata the harness needs to gate,
render, audit and schedule it:

    @tool(name="calendar_create_event", risk=Risk.WRITE, activity="Создаю событие")
    async def create_event(ctx: ToolContext, args: CreateEventArgs) -> dict: ...

- name / description / input schema (pydantic) → sent to the model
- output model (optional) → validated before the result reaches the model
- risk → mapped to an approval tier by the permission policy
- timeout / retries / idempotent → executor behaviour
- untrusted_output → result is fenced as external content (prompt-injection hygiene)
- activity → the safe status line users see ("Проверяю календарь")
"""

from __future__ import annotations

import enum
import inspect
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel

if TYPE_CHECKING:  # pragma: no cover
    from jarvis.core.container import AppContext


class Risk(str, enum.Enum):
    READ = "read"  # observe only
    WRITE = "write"  # change JARVIS-owned / user-owned data
    EXTERNAL = "external"  # something leaves the system (send, post, pay-less-than-high)
    HIGH = "high"  # destructive / financial / security-sensitive


class Tier(str, enum.Enum):
    AUTONOMOUS = "autonomous"
    CONFIRM = "confirm"
    RESTRICTED = "restricted"
    FORBIDDEN = "forbidden"

    @property
    def rank(self) -> int:
        return {"autonomous": 0, "confirm": 1, "restricted": 2, "forbidden": 3}[self.value]


class ToolError(Exception):
    """Expected failure with a message safe to show the model (and user)."""

    def __init__(self, message: str, *, retryable: bool = False, hint: str | None = None):
        super().__init__(message)
        self.retryable = retryable
        self.hint = hint


@dataclass
class ToolContext:
    app: "AppContext"
    user_id: uuid.UUID
    task_id: uuid.UUID | None = None
    conversation_id: uuid.UUID | None = None
    channel: str = "web"
    timezone: str = "UTC"
    trace_id: str | None = None
    depth: int = 0  # sub-agent nesting depth
    tool_use_id: str | None = None
    emit: Callable[[str, dict[str, Any]], Awaitable[None]] | None = None

    async def progress(self, message: str, **data: Any) -> None:
        if self.emit is not None:
            await self.emit("tool.progress", {"message": message, **data})


ToolFn = Callable[[ToolContext, Any], Awaitable[Any]]


@dataclass
class ToolSpec:
    name: str
    description: str
    fn: ToolFn
    input_model: type[BaseModel] | None = None
    raw_input_schema: dict[str, Any] | None = None  # for MCP / dynamic tools
    output_model: type[BaseModel] | None = None
    risk: Risk = Risk.READ
    activity: str = ""
    timeout_s: float = 30.0
    retries: int = 0
    idempotent: bool = True
    untrusted_output: bool = False
    parallel_safe: bool = True
    requires: tuple[str, ...] = ()  # integrations/services that must be available
    skill: str | None = None
    source: str = "builtin"  # builtin | skill | mcp
    summarize: Callable[[dict[str, Any]], str] | None = None
    max_output_chars: int = 24000
    tags: tuple[str, ...] = field(default_factory=tuple)

    def input_schema(self) -> dict[str, Any]:
        if self.raw_input_schema is not None:
            return self.raw_input_schema
        if self.input_model is None:
            return {"type": "object", "properties": {}, "additionalProperties": False}
        return inline_refs(self.input_model.model_json_schema())

    def to_model_tool(self) -> dict[str, Any]:
        return {"name": self.name, "description": self.description, "input_schema": self.input_schema()}

    def describe(self, args: dict[str, Any]) -> str:
        if self.summarize is not None:
            try:
                return self.summarize(args)
            except Exception:  # noqa: BLE001 - summary is best effort
                pass
        shown = ", ".join(f"{k}={str(v)[:120]!r}" for k, v in args.items())
        return f"{self.name}({shown})"


def inline_refs(schema: dict[str, Any]) -> dict[str, Any]:
    """Inline $defs/$ref and drop pydantic noise so every provider accepts the schema."""
    defs = schema.get("$defs", {})

    def walk(node: Any) -> Any:
        if isinstance(node, dict):
            if "$ref" in node:
                ref = node["$ref"].split("/")[-1]
                merged = {**defs.get(ref, {}), **{k: v for k, v in node.items() if k != "$ref"}}
                return walk(merged)
            return {k: walk(v) for k, v in node.items() if k not in ("$defs", "title")}
        if isinstance(node, list):
            return [walk(v) for v in node]
        return node

    out = walk(schema)
    out.setdefault("type", "object")
    out.setdefault("properties", {})
    return out


_COLLECTED: list[ToolSpec] = []


def tool(
    *,
    name: str,
    description: str,
    risk: Risk = Risk.READ,
    activity: str = "",
    output: type[BaseModel] | None = None,
    timeout_s: float = 30.0,
    retries: int = 0,
    idempotent: bool | None = None,
    untrusted_output: bool = False,
    parallel_safe: bool | None = None,
    requires: tuple[str, ...] = (),
    summarize: Callable[[dict[str, Any]], str] | None = None,
    max_output_chars: int = 24000,
) -> Callable[[ToolFn], ToolFn]:
    """Declare a tool. The input model is taken from the function's second parameter annotation."""

    def decorator(fn: ToolFn) -> ToolFn:
        params = list(inspect.signature(fn).parameters.values())
        input_model = None
        if len(params) >= 2:
            ann = params[1].annotation
            if isinstance(ann, str):
                ann = fn.__globals__.get(ann, ann)
            if inspect.isclass(ann) and issubclass(ann, BaseModel):
                input_model = ann
        spec = ToolSpec(
            name=name,
            description=description.strip(),
            fn=fn,
            input_model=input_model,
            output_model=output,
            risk=risk,
            activity=activity,
            timeout_s=timeout_s,
            retries=retries,
            idempotent=(risk == Risk.READ) if idempotent is None else idempotent,
            untrusted_output=untrusted_output,
            parallel_safe=(risk == Risk.READ) if parallel_safe is None else parallel_safe,
            requires=requires,
            summarize=summarize,
            max_output_chars=max_output_chars,
        )
        fn.__jarvis_tool__ = spec  # type: ignore[attr-defined]
        _COLLECTED.append(spec)
        return fn

    return decorator


def specs_in_module(module: Any) -> list[ToolSpec]:
    return [obj.__jarvis_tool__ for obj in vars(module).values() if hasattr(obj, "__jarvis_tool__")]
