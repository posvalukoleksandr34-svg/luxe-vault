import pytest

from jarvis.testing import run_tasks

pytestmark = pytest.mark.integration


async def test_health_and_metrics_protection(api, app):
    assert (await api.get("/api/health")).json()["ok"] is True
    ready = await api.get("/api/ready")
    assert ready.status_code == 200 and ready.json()["checks"]["database"]
    assert (await api.get("/metrics")).status_code == 401
    app.settings.metrics_token = "m3trics"
    try:
        r = await api.get("/metrics", headers={"Authorization": "Bearer m3trics"})
        assert r.status_code == 200 and "jarvis_tool_calls_total" in r.text
    finally:
        app.settings.metrics_token = None


async def test_auth_required_and_csrf_header(api, user):
    assert (await api.get("/api/tasks")).status_code == 401
    r = await api.post("/api/auth/login", json={"email": user.email, "password": "wrong password!!"})
    assert r.status_code == 401
    r = await api.post("/api/auth/login", json={"email": user.email, "password": "correct horse battery"})
    assert r.status_code == 200 and "jarvis_session" in r.cookies
    me = await api.get("/api/auth/me")
    assert me.json()["user"]["email"] == user.email
    # state-changing call without the CSRF header is rejected even with a valid cookie
    r = await api.post("/api/chat", json={"text": "hi"}, headers={"X-Jarvis-Request": ""})
    assert r.status_code == 403
    assert r.json()["detail"] == "missing X-Jarvis-Request header"
    assert (await api.get("/", headers={})).status_code in (200, 404)


async def test_chat_roundtrip_via_api(authed, app):
    r = await authed.post("/api/chat", json={"text": "запомни, что я люблю утренние пробежки"})
    assert r.status_code == 200, r.text
    conv = r.json()["conversation_id"]
    await run_tasks(app)
    msgs = (await authed.get(f"/api/conversations/{conv}/messages")).json()["messages"]
    assert msgs[-1]["role"] == "assistant" and "Запомнил" in msgs[-1]["content"]
    mem = (await authed.get("/api/memory", params={"q": "пробежки"})).json()
    assert mem["total"] >= 1
    task_id = r.json()["task_id"]
    detail = (await authed.get(f"/api/tasks/{task_id}")).json()
    assert detail["task"]["status"] == "succeeded" and detail["tool_calls"][0]["tool"] == "memory_remember"
    assert detail["llm_calls"]


async def test_memory_crud_and_export(authed):
    r = await authed.post("/api/memory", json={"content": "Любимый цвет — синий", "kind": "profile", "pinned": True})
    mid = r.json()["memory"]["id"]
    r = await authed.patch(f"/api/memory/{mid}", json={"content": "Любимый цвет — тёмно-синий"})
    assert r.json()["memory"]["content"].endswith("тёмно-синий")
    found = (await authed.get("/api/memory/search", params={"q": "цвет"})).json()["results"]
    assert found[0]["id"] == mid
    assert (await authed.delete(f"/api/memory/{mid}")).json()["ok"]
    export = (await authed.get("/api/memory/export")).json()
    assert all(m["id"] != mid for m in export["memories"])


async def test_permissions_rules_require_elevation_to_relax(authed):
    r = await authed.put("/api/permissions/rules", json={"target": "email_send_draft", "tier": "autonomous"})
    assert r.status_code == 428
    r = await authed.post("/api/auth/elevate", json={"password": "correct horse battery"})
    assert r.status_code == 200
    r = await authed.put("/api/permissions/rules", json={"target": "email_send_draft", "tier": "autonomous"})
    assert r.status_code == 200
    tools = (await authed.get("/api/tools")).json()["tools"]
    assert next(t for t in tools if t["name"] == "email_send_draft")["tier"] == "autonomous"
    rule_id = r.json()["id"]
    assert (await authed.delete(f"/api/permissions/rules/{rule_id}")).json()["ok"]
    r = await authed.put("/api/permissions/rules", json={"target": "risk:high", "tier": "autonomous"})
    assert r.status_code == 400


async def test_secrets_are_write_only(authed):
    r = await authed.put("/api/settings/secrets/tavily_api_key", json={"value": "tvly-secret"})
    assert r.status_code == 428  # needs re-auth
    await authed.post("/api/auth/elevate", json={"password": "correct horse battery"})
    assert (await authed.put("/api/settings/secrets/tavily_api_key", json={"value": "tvly-secret"})).status_code == 200
    settings = (await authed.get("/api/settings")).json()
    assert settings["secrets"]["tavily_api_key"] == {"configured": True, "source": "ui"}
    assert "tvly-secret" not in str(settings)
    await authed.put("/api/settings/secrets/tavily_api_key", json={"value": None})


async def test_dashboard_endpoints(authed):
    for path in ("/api/stats", "/api/system/status", "/api/skills", "/api/tools", "/api/permissions",
                 "/api/integrations", "/api/automations", "/api/notifications", "/api/logs/audit",
                 "/api/logs/tools", "/api/logs/llm", "/api/logs/audit/verify", "/api/calendar", "/api/approvals",
                 "/api/conversations", "/api/auth/sessions", "/api/voice/config", "/api/drafts"):
        r = await authed.get(path)
        assert r.status_code == 200, (path, r.text)
    assert (await authed.get("/api/logs/audit/verify")).json()["ok"] is True


async def test_device_token_scopes(authed, api):
    r = await authed.post("/api/devices".replace("/api/devices", "/api/auth/devices"),
                          json={"name": "kitchen satellite", "scopes": ["voice"]})
    token = r.json()["token"]
    r = await api.post("/api/chat", json={"text": "hi"}, headers={"Authorization": f"Bearer {token}"},
                       cookies={})
    assert r.status_code == 403  # voice-only token cannot use chat


async def test_setup_flow_requires_code(app, api):
    from jarvis.api.routes.auth import ensure_setup_code, setup_code_path

    # users already exist in the shared test DB → setup is closed
    assert (await api.get("/api/auth/setup")).json()["needs_setup"] is False
    r = await api.post("/api/auth/setup", json={"setup_code": "X", "email": "a@b.cd", "password": "0123456789"})
    assert r.status_code == 409
    assert await ensure_setup_code(app) is None and not setup_code_path(app).exists()
