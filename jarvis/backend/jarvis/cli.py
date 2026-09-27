"""Operator CLI.

    jarvis migrate                 apply database migrations
    jarvis create-user EMAIL       create a user (prompts for password)
    jarvis reset-password EMAIL
    jarvis device-token EMAIL NAME [--scopes voice,chat]
    jarvis rotate-keys             re-encrypt all secrets with the newest master key
    jarvis reembed                 (re)index memories for the current embedding model
    jarvis verify-audit            check the audit hash chain
    jarvis doctor                  configuration & connectivity check
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import select, text

from jarvis.core.container import build_app
from jarvis.settings import get_settings


def _alembic_ini() -> Path:
    candidates = [Path(os.environ["JARVIS_ALEMBIC_INI"])] if os.environ.get("JARVIS_ALEMBIC_INI") else []
    candidates += [Path(__file__).resolve().parents[1] / "alembic.ini", Path.cwd() / "alembic.ini",
                   Path("/app/backend/alembic.ini")]
    for c in candidates:
        if c.exists():
            return c
    raise SystemExit("alembic.ini not found; set JARVIS_ALEMBIC_INI")


def _migrate() -> int:
    ini = _alembic_ini()
    return subprocess.call([sys.executable, "-m", "alembic", "-c", str(ini), "upgrade", "head"], cwd=ini.parent)


async def _create_user(email: str, owner: bool) -> None:
    from jarvis.api.routes.auth import create_user

    app = await build_app(get_settings())
    try:
        pw = getpass.getpass("Password (min 10 chars): ")
        user = await create_user(app, email=email, password=pw, name=email.split("@")[0],
                                 timezone=app.settings.timezone, owner=owner)
        print(f"created {user.email}")
    finally:
        await app.close()


async def _reset_password(email: str) -> None:
    from jarvis.db.models import User
    from jarvis.security.passwords import hash_password

    app = await build_app(get_settings())
    try:
        async with app.sessionmaker() as session:
            user = (await session.execute(select(User).where(User.email == email.lower()))).scalar_one()
            user.password_hash = hash_password(getpass.getpass("New password: "))
            user.failed_logins, user.locked_until = 0, None
            await session.commit()
        print("password updated")
    finally:
        await app.close()


async def _device_token(email: str, name: str, scopes: str) -> None:
    from jarvis.db.models import AuthSession, User
    from jarvis.security.crypto import new_token, token_hash

    app = await build_app(get_settings())
    try:
        async with app.sessionmaker() as session:
            user = (await session.execute(select(User).where(User.email == email.lower()))).scalar_one()
            token = new_token("jv_dev")
            session.add(AuthSession(user_id=user.id, token_hash=token_hash(token), kind="device", name=name,
                                    scopes=[s.strip() for s in scopes.split(",") if s.strip()]))
            await session.commit()
        print(token)
    finally:
        await app.close()


async def _rotate_keys() -> None:
    from jarvis.db.models import Integration, SystemSetting, User

    app = await build_app(get_settings())
    try:
        n = 0
        async with app.sessionmaker() as session:
            for row in (await session.execute(select(SystemSetting).where(SystemSetting.secret_enc.is_not(None)))).scalars():
                row.secret_enc = app.box.rotate(row.secret_enc)
                n += 1
            for row in (await session.execute(select(Integration).where(Integration.credentials_enc.is_not(None)))).scalars():
                row.credentials_enc = app.box.rotate(row.credentials_enc)
                n += 1
            for row in (await session.execute(select(User).where(User.totp_secret_enc.is_not(None)))).scalars():
                row.totp_secret_enc = app.box.rotate(row.totp_secret_enc)
                n += 1
            await session.commit()
        print(f"re-encrypted {n} secrets with the primary key; you may now remove old keys from JARVIS_MASTER_KEYS")
    finally:
        await app.close()


async def _reembed() -> None:
    app = await build_app(get_settings())
    try:
        print(f"indexed {await app.memory.reembed_all()} memories with {app.embedder.model}")
    finally:
        await app.close()


async def _verify_audit() -> int:
    from jarvis.core.audit import verify_chain

    app = await build_app(get_settings())
    try:
        async with app.sessionmaker() as session:
            ok, broken = await verify_chain(session)
        print("audit chain OK" if ok else f"audit chain BROKEN at id={broken}")
        return 0 if ok else 2
    finally:
        await app.close()


async def _doctor() -> int:
    s = get_settings()
    app = await build_app(s)
    problems = 0
    try:
        async with app.sessionmaker() as session:
            await session.execute(text("SELECT 1"))
            ext = set((await session.execute(text("SELECT extname FROM pg_extension"))).scalars())
        print("✓ database reachable; extensions:", ", ".join(sorted(ext)))
        if "vector" not in ext:
            print("✗ pgvector missing — run migrations"); problems += 1
        if app.redis is not None:
            await app.redis.ping()
            print("✓ redis reachable")
        key = await app.secrets.get("anthropic_api_key")
        print("✓ Anthropic key configured" if key else "✗ Anthropic key missing (Settings → Models or ANTHROPIC_API_KEY)")
        problems += 0 if key or s.fake_llm else 1
        print(f"• embeddings: {app.embedder.model} ({'on' if app.embedder.enabled else 'off'})")
        print(f"• skills: {', '.join(sorted(app.skills.skills))}")
        print(f"• tools: {len(app.registry.all())}")
        print(f"• voice: stt={await app.voice.stt_provider()} tts={await app.voice.tts_provider()}")
        print(f"• browser: {'on' if app.browser.available else 'off'}; sandbox: {'on' if app.sandbox.available else 'off'}")
        print(f"• public url: {s.public_url} (cookies secure={s.secure_cookies})")
    finally:
        await app.close()
    return 1 if problems else 0


def main() -> None:
    parser = argparse.ArgumentParser(prog="jarvis")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("migrate")
    cu = sub.add_parser("create-user")
    cu.add_argument("email")
    cu.add_argument("--owner", action="store_true")
    rp = sub.add_parser("reset-password")
    rp.add_argument("email")
    dt = sub.add_parser("device-token")
    dt.add_argument("email")
    dt.add_argument("name")
    dt.add_argument("--scopes", default="voice,chat")
    sub.add_parser("rotate-keys")
    sub.add_parser("reembed")
    sub.add_parser("verify-audit")
    sub.add_parser("doctor")
    args = parser.parse_args()
    if args.cmd == "migrate":
        sys.exit(_migrate())
    if args.cmd == "create-user":
        asyncio.run(_create_user(args.email, args.owner))
    elif args.cmd == "reset-password":
        asyncio.run(_reset_password(args.email))
    elif args.cmd == "device-token":
        asyncio.run(_device_token(args.email, args.name, args.scopes))
    elif args.cmd == "rotate-keys":
        asyncio.run(_rotate_keys())
    elif args.cmd == "reembed":
        asyncio.run(_reembed())
    elif args.cmd == "verify-audit":
        sys.exit(asyncio.run(_verify_audit()))
    elif args.cmd == "doctor":
        sys.exit(asyncio.run(_doctor()))


if __name__ == "__main__":
    main()
