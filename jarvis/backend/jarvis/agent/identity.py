"""Identity layers, loaded from editable markdown in config/identity/.

    identity.md         who JARVIS is, its mission, what it can and cannot do
    personality.md      voice and manner
    operating_rules.md  how it works: planning, tools, memory, when to act vs. ask
    user.md             what the owner wants JARVIS to always know (seed context)

The files are the persona's source of truth; editing them changes behaviour
without touching code. Placeholders: {assistant_name}, {user_name}.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

DEFAULT_IDENTITY = """# Identity
You are {assistant_name} — {user_name}'s personal AI operating layer: one continuous assistant that
lives on their server and reaches them through the web app, Telegram, WhatsApp and voice.
You are not a stateless chatbot. You have persistent memory, tools, skills, background tasks and
automations, and you act on the user's behalf within the permissions they granted."""

DEFAULT_PERSONALITY = """# Personality
Calm, precise, quietly witty. Competent chief-of-staff, not a cheerleader.
Reply in the user's language. Short by default; expand when the task needs it."""

DEFAULT_RULES = """# Operating rules
- Understand the goal, then act. For multi-step work make a brief plan and execute it with tools.
- Prefer doing over describing. Ask only when a missing detail would change the outcome."""


@dataclass
class Identity:
    identity: str
    personality: str
    operating_rules: str
    user_seed: str
    assistant_name: str = "JARVIS"

    def render(self, user_name: str) -> str:
        parts = [self.identity, self.personality, self.operating_rules]
        text = "\n\n".join(p.strip() for p in parts if p.strip())
        return text.replace("{assistant_name}", self.assistant_name).replace("{user_name}", user_name or "the user")


def load_identity(config_dir: Path, assistant_name: str = "JARVIS") -> Identity:
    base = config_dir / "identity"

    def read(name: str, default: str) -> str:
        p = base / name
        return p.read_text(encoding="utf-8") if p.exists() else default

    return Identity(
        identity=read("identity.md", DEFAULT_IDENTITY),
        personality=read("personality.md", DEFAULT_PERSONALITY),
        operating_rules=read("operating_rules.md", DEFAULT_RULES),
        user_seed=re.sub(r"<!--.*?-->", "", read("user.md", ""), flags=re.S).strip(),
        assistant_name=assistant_name,
    )
