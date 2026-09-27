import httpx
import pytest

from jarvis.integrations.sandbox import SandboxClient
from jarvis.tools.base import ToolError


async def test_sandbox_client_sends_token_and_parses():
    seen = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen["auth"] = req.headers.get("authorization")
        return httpx.Response(200, json={"exit_code": 0, "stdout": "42\n", "stderr": "", "timed_out": False})

    client = SandboxClient("http://sandbox:8090", "t0k", transport=httpx.MockTransport(handler))
    out = await client.exec("echo 42")
    assert out["stdout"] == "42\n" and seen["auth"] == "Bearer t0k"


async def test_sandbox_unavailable():
    with pytest.raises(ToolError):
        await SandboxClient(None, None).exec("ls")


def test_sandbox_server_rejects_bad_token_and_denied_commands(monkeypatch):
    from fastapi.testclient import TestClient

    import jarvis.sandbox_server as srv

    monkeypatch.setattr(srv, "TOKEN", "secret")
    c = TestClient(srv.app)
    assert c.post("/exec", json={"command": "ls"}).status_code == 401
    r = c.post("/exec", json={"command": "rm -rf / "}, headers={"Authorization": "Bearer secret"})
    assert r.status_code == 400
