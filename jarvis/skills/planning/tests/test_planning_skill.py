from pathlib import Path

import yaml


def test_planning_is_instructions_only():
    manifest = yaml.safe_load((Path(__file__).parents[1] / "skill.yaml").read_text())
    assert manifest["tools"] == []
    text = (Path(__file__).parents[1] / "instructions.md").read_text()
    for tool in ("calendar_list_events", "reminder_create", "automation_create"):
        assert tool in text
