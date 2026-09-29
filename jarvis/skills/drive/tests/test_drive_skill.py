from jarvis.skills.manager import SkillManifest


def test_manifest_requires_google():
    import yaml
    from pathlib import Path

    m = SkillManifest.model_validate(yaml.safe_load((Path(__file__).parents[1] / "skill.yaml").read_text()))
    assert m.requires == ["google"]
    assert set(m.tools) == {"drive_search", "drive_read", "drive_upload"}
