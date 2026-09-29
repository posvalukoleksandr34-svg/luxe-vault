"""The device token lives in the OS credential store (Windows Credential Manager, macOS Keychain, Secret
Service on Linux) — encrypted by the OS for the signed-in Windows user. The password is never stored."""

from __future__ import annotations

import keyring
from keyring.errors import KeyringError, PasswordDeleteError

from app.config import KEYRING_SERVICE, SERVER_URL


def _account() -> str:
    return SERVER_URL  # one token per server: a dev build and the production build do not mix


def load_token() -> str | None:
    try:
        return keyring.get_password(KEYRING_SERVICE, _account())
    except KeyringError:
        return None


def save_token(token: str) -> None:
    keyring.set_password(KEYRING_SERVICE, _account(), token)


def delete_token() -> None:
    try:
        keyring.delete_password(KEYRING_SERVICE, _account())
    except (PasswordDeleteError, KeyringError):
        pass
