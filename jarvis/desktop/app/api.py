"""The few HTTP calls the app makes itself (everything else goes over the device/voice WebSockets)."""

from __future__ import annotations

import socket

import httpx

from app.config import SERVER_URL


class LoginError(Exception):
    def __init__(self, message: str, *, needs_totp: bool = False):
        super().__init__(message)
        self.needs_totp = needs_totp


MESSAGES = {
    401: "Неверный e-mail или пароль.",
    403: "Вход запрещён.",
    423: "Слишком много неудачных попыток — аккаунт временно заблокирован (15 минут).",
    429: "Слишком много попыток — подождите несколько минут.",
}


def _detail(r: httpx.Response) -> str:
    try:
        d = r.json().get("detail")
    except ValueError:
        return ""
    return d.get("message", "") if isinstance(d, dict) else str(d or "")


def device_login(email: str, password: str, totp: str | None = None) -> str:
    """E-mail + password (+ 2FA) → device token for this PC."""
    try:
        r = httpx.post(f"{SERVER_URL}/api/auth/device-login", timeout=20, json={
            "email": email.strip(), "password": password, "totp": (totp or "").strip() or None,
            "device_name": socket.gethostname()[:100] or "Windows PC"})
    except httpx.HTTPError as exc:
        raise LoginError(f"Сервер JARVIS недоступен ({SERVER_URL}). Проверьте интернет.") from exc
    if r.status_code == 200:
        return r.json()["token"]
    detail = _detail(r)
    if r.status_code == 401 and detail == "totp_required":
        raise LoginError("Введите код двухфакторной аутентификации.", needs_totp=True)
    if r.status_code == 403 and ("verify" in detail.lower() or "e-mail" in detail.lower()):
        raise LoginError("Подтвердите e-mail по ссылке из письма и попробуйте снова.")
    raise LoginError(MESSAGES.get(r.status_code) or detail or f"Ошибка входа ({r.status_code}).")


def handoff_url(token: str, next_path: str = "/widget") -> str | None:
    """A one-time link that opens the web UI already signed in (None if the token no longer works)."""
    try:
        r = httpx.post(f"{SERVER_URL}/api/auth/handoff", timeout=15, json={"next": next_path},
                       headers={"Authorization": f"Bearer {token}"})
    except httpx.HTTPError:
        return None
    return r.json().get("url") if r.status_code == 200 else None


def token_valid(token: str) -> bool | None:
    """True/False; None when the server cannot be reached (then keep the token and retry later)."""
    try:
        r = httpx.get(f"{SERVER_URL}/api/auth/me", timeout=10, headers={"Authorization": f"Bearer {token}"})
    except httpx.HTTPError:
        return None
    return r.status_code == 200


def logout(token: str) -> None:
    try:
        httpx.post(f"{SERVER_URL}/api/auth/logout", timeout=10, headers={"Authorization": f"Bearer {token}"})
    except httpx.HTTPError:
        pass  # offline: the token is deleted locally anyway; it can be revoked in Settings → Devices
