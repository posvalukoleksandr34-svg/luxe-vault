import sys
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest

from jarvis.tools.base import ToolContext, ToolError


@pytest.fixture
def apis(tmp_path):
    from jarvis.skills.manager import SkillManager
    from jarvis.tools.registry import ToolRegistry

    SkillManager(Path(__file__).parents[2], ToolRegistry(), None).discover()
    (tmp_path / "connectors.yaml").write_text(
        "connectors:\n  - name: ha\n    base_url: http://10.0.0.2:8123/api\n    allow: ['states*']\n")
    app = SimpleNamespace(settings=SimpleNamespace(config_dir=tmp_path))
    return sys.modules["jarvis_skill_apis"], ToolContext(app=app, user_id=uuid.uuid4())


async def test_path_allowlist_and_private_network_guard(apis):
    mod, ctx = apis
    with pytest.raises(ToolError, match="not allowed"):
        await mod._request(ctx, "ha", "GET", "services/lock/unlock")
    with pytest.raises(ToolError, match="URL not allowed"):
        await mod._request(ctx, "ha", "GET", "states/light.kitchen")  # LAN target without explicit opt-in
    with pytest.raises(ToolError, match="unknown connector"):
        await mod._request(ctx, "nope", "GET", "x")
