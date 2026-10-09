"""Agent profiles: the orchestrator and the few specialists worth having.

Sub-agents exist only where isolation measurably helps:
  - research  — many searches/fetches whose raw pages would flood the main context
  - browser   — dozens of low-level page steps
  - coding    — iterative command/edit loops in the sandbox
  - planner   — reads calendar/tasks/memory and proposes a schedule (no writes)
Everything else stays with the orchestrator. Sub-agents are read-mostly: they
only receive tools the policy lets run autonomously, and hand side effects back
to the orchestrator, which asks the user when required.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class AgentProfile:
    name: str
    title: str
    route: str
    description: str
    instructions: str = ""
    tools: frozenset[str] | None = None  # None = every available tool
    max_steps: int = 25
    subagent: bool = False
    extra: dict = field(default_factory=dict)


ORCHESTRATOR = AgentProfile(
    name="jarvis",
    title="JARVIS",
    route="main",
    description="Main orchestrator",
    max_steps=25,
)

SUBAGENTS: dict[str, AgentProfile] = {
    "research": AgentProfile(
        name="research",
        title="Research agent",
        route="worker",
        description="Deep web research: searches, reads sources, cross-checks and returns a cited report.",
        instructions=(
            "You are the research specialist. Search broadly, open the most relevant sources, cross-check "
            "claims, and return a structured report: key findings, comparison where relevant, open questions, "
            "and a numbered source list with URLs. Be explicit about uncertainty. Do not invent sources."
        ),
        tools=frozenset({"web_search", "web_fetch", "memory_search", "time_now", "files_write", "files_read"}),
        max_steps=30,
        subagent=True,
    ),
    "browser": AgentProfile(
        name="browser",
        title="Browser agent",
        route="worker",
        description="Operates a real browser: opens pages, reads, clicks, fills forms, takes screenshots.",
        instructions=(
            "You drive a headless browser. Work step by step: open, snapshot, act on element refs, verify. "
            "Never submit payments, passwords or irreversible forms — report back what would be submitted instead."
        ),
        tools=frozenset({"browser_open", "browser_snapshot", "browser_click", "browser_type", "browser_screenshot",
                         "web_fetch", "time_now"}),
        max_steps=40,
        subagent=True,
    ),
    "coding": AgentProfile(
        name="coding",
        title="Coding agent",
        route="worker",
        description="Writes and runs code in the isolated sandbox; returns results and produced files.",
        instructions=(
            "You are the coding specialist working in an isolated sandbox with a /workspace directory. "
            "Write code to files, run it, read errors, fix, and repeat until it works. Report the final "
            "result, the files you produced and how to run them."
        ),
        tools=frozenset({"sandbox_exec", "files_read", "files_write", "files_list", "web_fetch", "time_now"}),
        max_steps=40,
        subagent=True,
    ),
    "planner": AgentProfile(
        name="planner",
        title="Planning agent",
        route="worker",
        description="Analyses calendar, reminders and memory to propose a concrete schedule or plan (read-only).",
        instructions=(
            "You are the planning specialist. Read the calendar, reminders and relevant memories, then propose a "
            "concrete plan with times. Do not create or change anything — return the proposal; the orchestrator "
            "will apply it."
        ),
        tools=frozenset({"calendar_list_events", "calendar_find_free_time", "reminder_list", "memory_search",
                         "time_now", "automation_list"}),
        max_steps=15,
        subagent=True,
    ),
}


def get_profile(name: str | None) -> AgentProfile:
    if not name or name == "jarvis":
        return ORCHESTRATOR
    return SUBAGENTS.get(name, ORCHESTRATOR)
