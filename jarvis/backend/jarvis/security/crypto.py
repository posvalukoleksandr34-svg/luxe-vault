"""Encryption at rest for credentials (OAuth tokens, provider keys, TOTP secrets).

MultiFernet (AES-128-CBC + HMAC-SHA256) with a key ring: the first key encrypts,
every key decrypts. Rotation = prepend a new key, run `jarvis rotate-keys`
(re-encrypts every secret), then drop the old key.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet, InvalidToken, MultiFernet


class SecretBox:
    def __init__(self, keys: list[str]):
        if not keys:
            raise ValueError("SecretBox needs at least one key")
        self._keys = keys
        self._fernet = MultiFernet([Fernet(k.encode()) for k in keys])

    @property
    def keys(self) -> list[str]:
        return list(self._keys)

    def encrypt(self, plaintext: str) -> str:
        return self._fernet.encrypt(plaintext.encode()).decode()

    def decrypt(self, token: str) -> str:
        try:
            return self._fernet.decrypt(token.encode()).decode()
        except InvalidToken as exc:  # wrong/rotated-away key or tampering
            raise ValueError("cannot decrypt secret: invalid key or corrupted data") from exc

    def encrypt_json(self, data: Any) -> str:
        return self.encrypt(json.dumps(data, separators=(",", ":"), sort_keys=True))

    def decrypt_json(self, token: str) -> Any:
        return json.loads(self.decrypt(token))

    def rotate(self, token: str) -> str:
        """Re-encrypt with the primary key."""
        return self._fernet.rotate(token.encode()).decode()


def load_or_create_keys(configured: str, secrets_dir: Path) -> list[str]:
    """Env-provided keys win; otherwise persist a generated key under the data volume (0600)."""
    keys = [k.strip() for k in configured.split(",") if k.strip()]
    if keys:
        return keys
    path = secrets_dir / "master.keys"
    if path.exists():
        return [k.strip() for k in path.read_text().splitlines() if k.strip()]
    secrets_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(secrets_dir, 0o700)
    key = Fernet.generate_key().decode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as fh:
        fh.write(key + "\n")
    return [key]


def token_hash(token: str) -> str:
    """Tokens are stored only as SHA-256 — a DB leak does not leak live sessions."""
    return hashlib.sha256(token.encode()).hexdigest()


def new_token(prefix: str, nbytes: int = 32) -> str:
    return f"{prefix}_{secrets.token_urlsafe(nbytes)}"


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())
