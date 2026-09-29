"""Skills: pluggable capabilities that live in their own folder.

    skills/<name>/
        skill.yaml        manifest — name, description, triggers, tools, permissions, config defaults
        instructions.md   how JARVIS should perform this kind of work (loaded on demand)
        tools.py          @tool functions this skill contributes (optional)
        tests/            skill tests (run by pytest together with the core suite)

Adding a skill = dropping a folder and restarting; nothing in the core changes.

Progressive disclosure keeps the prompt small and cache-friendly: the system
prompt lists each enabled skill in one line; the model calls `skill_load` to
read the full instructions only when a task needs them. A cheap keyword match
adds a per-turn hint ("relevant skills: calendar") to the user turn.
"""

from __future__ import annotations

import importlib.util
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from jarvis.core.logging import log
from jarvis.db.models import SkillState
from jarvis.tools.base import Tier, ToolSpec, specs_in_module
from jarvis.tools.registry import ToolRegistry

_NAME = re.compile(r"^[a-z][a-z0-9_]{1,40}$")


class SkillManifest(BaseModel):
    name: str
    version: str = "0.1.0"
    title: str = ""
    description: str
    triggers: list[str] = Field(default_factory=list)
    tools: list[str] = Field(default_factory=list)
    requires: list[str] = Field(default_factory=list)
    permissions: dict[str, Tier] = Field(default_factory=dict)
    config: dict[str, Any] = Field(default_factory=dict)
    enabled_by_default: bool = True
    icon: str = "sparkles"


@dataclass
class Skill:
    manifest: SkillManifest
    path: Path
    instructions: str
    tools: list[ToolSpec] = field(default_factory=list)
    error: str | None = None

    @property
    def name(self) -> str:
        return self.manifest.name


class SkillManager:
    def __init__(self, skills_dir: Path, registry: ToolRegistry, sessionmaker: async_sessionmaker[AsyncSession]):
        self.skills_dir = skills_dir
        self.registry = registry
        self.sessionmaker = sessionmaker
        self.skills: dict[str, Skill] = {}
        self._enabled: dict[str, bool] = {}
        self._config: dict[str, dict[str, Any]] = {}

    # ------------------------------------------------------------------ discovery

    def discover(self) -> list[Skill]:
        self.registry.unregister_where(lambda s: s.source == "skill")
        self.skills.clear()
        if not self.skills_dir.exists():
            log.warning("skills.dir_missing", path=str(self.skills_dir))
            return []
        for folder in sorted(p for p in self.skills_dir.iterdir() if p.is_dir() and not p.name.startswith((".", "_"))):
            manifest_path = folder / "skill.yaml"
            if not manifest_path.exists():
                continue
            try:
                manifest = SkillManifest.model_validate(yaml.safe_load(manifest_path.read_text()) or {})
                if not _NAME.match(manifest.name):
                    raise ValueError(f"invalid skill name {manifest.name!r}")
            except (ValidationError, ValueError, yaml.YAMLError) as exc:
                log.error("skills.bad_manifest", path=str(manifest_path), error=str(exc))
                continue
            instr_path = folder / "instructions.md"
            skill = Skill(manifest=manifest, path=folder,
                          instructions=instr_path.read_text() if instr_path.exists() else manifest.description)
            tools_path = folder / "tools.py"
            if tools_path.exists():
                try:
                    skill.tools = self._import_tools(manifest.name, tools_path)
                except Exception as exc:  # noqa: BLE001 - a broken skill must not take the system down
                    skill.error = f"{type(exc).__name__}: {exc}"
                    log.exception("skills.import_failed", skill=manifest.name)
            for spec in skill.tools:
                spec.skill = manifest.name
                spec.source = "skill"
                self.registry.register(spec, replace=True)
            declared = set(manifest.tools)
            provided = {t.name for t in skill.tools}
            if declared - provided and not skill.error:
                log.info("skills.tools_from_elsewhere", skill=manifest.name, tools=sorted(declared - provided))
            self.skills[manifest.name] = skill
        log.info("skills.loaded", skills=sorted(self.skills))
        return list(self.skills.values())

    @staticmethod
    def _import_tools(name: str, path: Path) -> list[ToolSpec]:
        mod_name = f"jarvis_skill_{name}"
        spec = importlib.util.spec_from_file_location(mod_name, path)
        if spec is None or spec.loader is None:
            raise ImportError(f"cannot import {path}")
        module = importlib.util.module_from_spec(spec)
        sys.modules[mod_name] = module
        spec.loader.exec_module(module)
        return specs_in_module(module)

    # ------------------------------------------------------------------ state

    async def refresh_state(self) -> None:
        async with self.sessionmaker() as session:
            rows = {r.name: r for r in (await session.execute(select(SkillState))).scalars()}
        self._enabled = {}
        self._config = {}
        for name, skill in self.skills.items():
            row = rows.get(name)
            self._enabled[name] = row.enabled if row else skill.manifest.enabled_by_default
            self._config[name] = {**skill.manifest.config, **(row.config if row else {})}
        disabled_tools = {t.name for n, s in self.skills.items() if not self._enabled.get(n, True) for t in s.tools}
        self.registry.set_disabled(disabled_tools)

    async def set_enabled(self, name: str, enabled: bool) -> None:
        async with self.sessionmaker() as session:
            row = await session.get(SkillState, name)
            if row is None:
                row = SkillState(name=name, enabled=enabled, config={})
                session.add(row)
            else:
                row.enabled = enabled
            await session.commit()
        await self.refresh_state()

    async def set_config(self, name: str, config: dict[str, Any]) -> None:
        async with self.sessionmaker() as session:
            row = await session.get(SkillState, name)
            if row is None:
                session.add(SkillState(name=name, enabled=True, config=config))
            else:
                row.config = config
            await session.commit()
        await self.refresh_state()

    def is_enabled(self, name: str) -> bool:
        return self._enabled.get(name, True)

    def config(self, name: str) -> dict[str, Any]:
        return dict(self._config.get(name) or (self.skills[name].manifest.config if name in self.skills else {}))

    def enabled(self) -> list[Skill]:
        return [s for n, s in sorted(self.skills.items()) if self.is_enabled(n)]

    # ------------------------------------------------------------------ prompting

    def index_text(self) -> str:
        lines = [f"- {s.name}: {s.manifest.description.strip()}" for s in self.enabled()]
        return "\n".join(lines) if lines else "(no skills installed)"

    def match(self, text: str, *, limit: int = 3) -> list[str]:
        low = text.lower()
        scored = []
        for s in self.enabled():
            hits = sum(1 for t in s.manifest.triggers if t.lower() in low)
            if hits:
                scored.append((hits, s.name))
        scored.sort(reverse=True)
        return [n for _, n in scored[:limit]]

    def instructions(self, name: str) -> str | None:
        s = self.skills.get(name)
        if s is None or not self.is_enabled(name):
            return None
        tools = ", ".join(sorted({*s.manifest.tools, *(t.name for t in s.tools)}))
        return f"# Skill: {s.manifest.title or s.name}\nTools: {tools or '(none)'}\n\n{s.instructions.strip()}"

    def permission_defaults(self) -> dict[str, Tier]:
        out: dict[str, Tier] = {}
        for s in self.skills.values():
            out.update(s.manifest.permissions)
        return out
