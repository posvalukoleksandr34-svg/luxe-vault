"""Tool registry — the single place the agent learns what it can do.

Sources: built-in tools, tools shipped by skills, tools discovered on MCP servers.
The list handed to the model is sorted by name so the prompt prefix stays byte-stable
(prompt caching), and filtered by availability (disabled skill, missing integration).
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from typing import Any

from jarvis.tools.base import ToolSpec


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, ToolSpec] = {}
        self._disabled: set[str] = set()

    def register(self, spec: ToolSpec, *, replace: bool = False) -> None:
        if spec.name in self._tools and not replace:
            raise ValueError(f"duplicate tool name: {spec.name}")
        self._tools[spec.name] = spec

    def register_many(self, specs: Iterable[ToolSpec], **kw: Any) -> None:
        for s in specs:
            self.register(s, **kw)

    def unregister_where(self, pred: Callable[[ToolSpec], bool]) -> None:
        for name in [n for n, s in self._tools.items() if pred(s)]:
            del self._tools[name]

    def get(self, name: str) -> ToolSpec | None:
        return self._tools.get(name)

    def all(self) -> list[ToolSpec]:
        return [self._tools[n] for n in sorted(self._tools)]

    def set_disabled(self, names: set[str]) -> None:
        self._disabled = set(names)

    def available(self, *, is_available: Callable[[ToolSpec], bool] | None = None,
                  only: set[str] | None = None) -> list[ToolSpec]:
        out = []
        for spec in self.all():
            if spec.name in self._disabled:
                continue
            if only is not None and spec.name not in only:
                continue
            if is_available is not None and not is_available(spec):
                continue
            out.append(spec)
        return out

    def model_tools(self, specs: list[ToolSpec]) -> list[dict[str, Any]]:
        return [s.to_model_tool() for s in specs]
