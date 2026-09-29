import json

import pytest

from jarvis.llm.fake import ScriptedProvider, text_response

pytestmark = pytest.mark.integration


async def test_add_dedupes_near_duplicates(app, user):
    m1, created1 = await app.memory.add(user.id, "Пользователь любит зелёный чай", kind="profile", importance=0.5)
    m2, created2 = await app.memory.add(user.id, "Пользователь любит зелёный чай.", kind="profile", importance=0.8)
    assert created1 and not created2 and m1.id == m2.id
    rows, total = await app.memory.list(user.id)
    assert total == 1 and rows[0].importance == pytest.approx(0.8)


async def test_hybrid_search_finds_by_meaning_words_and_inflection(app, user):
    await app.memory.add(user.id, "Пользователю нравится джаз и старые фильмы", kind="profile")
    await app.memory.add(user.id, "Анна — сестра пользователя, живёт в Берлине", kind="relationship", subject="Анна")
    await app.memory.add(user.id, "Проект JARVIS: персональный ИИ-ассистент на своём сервере", kind="project")
    found = await app.memory.search(user.id, "что мне нравится?")
    assert found and "джаз" in found[0].memory.content
    found = await app.memory.search(user.id, "где живёт Анна")
    assert found[0].memory.subject == "Анна"
    assert found[0].memory.access_count == 1  # retrieval is tracked


async def test_search_never_returns_other_users_memories(app, user):
    from jarvis.api.routes.auth import create_user

    other = await create_user(app, email="other-mem@test.local", password="correct horse battery", name="O",
                              timezone="UTC", owner=False)
    await app.memory.add(other.id, "Секретный факт другого пользователя про кофе")
    assert await app.memory.search(user.id, "кофе") == []


async def test_update_delete_and_core_profile(app, user):
    m, _ = await app.memory.add(user.id, "Аллергия на арахис", kind="important", importance=1.0)
    core = await app.memory.core_profile(user.id)
    assert m.id in {x.id for x in core}
    updated = await app.memory.update(user.id, m.id, content="Сильная аллергия на арахис", pinned=True)
    assert updated.content.startswith("Сильная") and updated.pinned
    assert await app.memory.delete(user.id, m.id)
    assert await app.memory.search(user.id, "арахис") == []


async def test_extraction_pipeline_stores_supersedes_and_skips(app, user, provider):
    old, _ = await app.memory.add(user.id, "Пользователь живёт в Москве", kind="profile", subject="user")

    def script(req, route):
        schema = req.output_schema or {}
        if "memories" in schema.get("properties", {}):
            return text_response(json.dumps({"memories": [
                {"content": "Пользователь переехал в Киев", "kind": "profile", "subject": "user", "importance": 0.8},
                {"content": "Пользователь сказал привет", "kind": "semantic", "subject": "user", "importance": 0.1},
                {"content": "Пользователь работает продакт-менеджером", "kind": "profile", "subject": "user",
                 "importance": 0.7},
            ]}))
        lines = req.messages[0]["content"]
        decisions = []
        for i in range(3):
            if f"NEW[{i}]" in lines and "Киев" in lines.split(f"NEW[{i}]")[1].split("\n")[0]:
                decisions.append({"index": i, "action": "supersede", "target_id": str(old.id),
                                  "merged_content": "Пользователь живёт в Киеве"})
        return text_response(json.dumps({"decisions": decisions}))

    provider.impl = ScriptedProvider(script)
    stored = await app.extractor.process_turn("Я переехал в Киев, работаю продактом", "Понял!", user_id=user.id)
    contents = {m.content for m in stored}
    assert "Пользователь живёт в Киеве" in contents
    assert "Пользователь работает продакт-менеджером" in contents
    assert not any("привет" in c for c in contents)  # low importance filtered
    rows, _ = await app.memory.list(user.id)
    assert "Пользователь живёт в Москве" not in {r.content for r in rows}  # superseded, no longer active


async def test_embedding_outage_degrades_to_keyword_search(app, user, monkeypatch, tmp_path):
    """No access to the model hub must not stall memory: the breaker trips once, search keeps working."""
    import time as _time

    from jarvis.memory.embeddings import LocalEmbedder

    emb = LocalEmbedder(None, tmp_path)
    calls = {"n": 0}

    def boom(*a, **k):
        calls["n"] += 1
        raise OSError("403 Forbidden")

    import sys
    import types

    monkeypatch.setitem(sys.modules, "fastembed", types.SimpleNamespace(TextEmbedding=boom))
    original = app.memory.embedder
    app.memory.embedder = emb
    try:
        assert emb.enabled
        t0 = _time.monotonic()
        await app.memory.add(user.id, "Пользователь играет на гитаре", kind="profile")
        found = await app.memory.search(user.id, "гитара")
        assert found and "гитаре" in found[0].memory.content
        assert calls["n"] == 1 and not emb.enabled  # breaker open after one failure
        assert _time.monotonic() - t0 < 5
    finally:
        app.memory.embedder = original
