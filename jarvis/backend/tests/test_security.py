import pytest
from cryptography.fernet import Fernet
from sqlalchemy import text

from jarvis.core.audit import audit, verify_chain
from jarvis.security.crypto import SecretBox, load_or_create_keys, token_hash
from jarvis.security.passwords import hash_password, verify_password


def test_secretbox_roundtrip_and_rotation():
    old = Fernet.generate_key().decode()
    new = Fernet.generate_key().decode()
    enc_old = SecretBox([old]).encrypt_json({"refresh_token": "r1"})
    box = SecretBox([new, old])  # new primary, old still decrypts
    assert box.decrypt_json(enc_old) == {"refresh_token": "r1"}
    rotated = box.rotate(enc_old)
    assert SecretBox([new]).decrypt_json(rotated) == {"refresh_token": "r1"}
    with pytest.raises(ValueError):
        SecretBox([Fernet.generate_key().decode()]).decrypt(rotated)


def test_master_key_generated_once_with_strict_permissions(tmp_path):
    keys1 = load_or_create_keys("", tmp_path / "secrets")
    keys2 = load_or_create_keys("", tmp_path / "secrets")
    assert keys1 == keys2
    assert oct((tmp_path / "secrets" / "master.keys").stat().st_mode)[-3:] == "600"
    assert load_or_create_keys("a,b", tmp_path / "x") == ["a", "b"]


def test_passwords():
    h = hash_password("correct horse battery")
    assert h.startswith("$argon2id$")
    assert verify_password(h, "correct horse battery")
    assert not verify_password(h, "wrong password!!")
    with pytest.raises(ValueError):
        hash_password("short")


def test_token_hash_is_stable_and_not_reversible():
    assert token_hash("jv_s_abc") == token_hash("jv_s_abc")
    assert "abc" not in token_hash("jv_s_abc")


@pytest.mark.integration
async def test_audit_chain_detects_tampering_and_is_append_only(app, user):
    async with app.sessionmaker() as session:
        for i in range(3):
            await audit(session, action="test.event", actor="system", user_id=user.id, data={"i": i, "password": "x"})
        await session.commit()
    async with app.sessionmaker() as session:
        ok, broken = await verify_chain(session)
        assert ok and broken is None
        row = (await session.execute(text("SELECT data FROM audit_log WHERE action='test.event' ORDER BY id DESC LIMIT 1"))).scalar()
        assert row["password"] == "***"  # secrets are redacted before they reach the log
    async with app.sessionmaker() as session:
        with pytest.raises(Exception, match="append-only"):
            await session.execute(text("UPDATE audit_log SET action='x' WHERE action='test.event'"))
            await session.commit()
