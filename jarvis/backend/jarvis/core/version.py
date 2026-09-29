"""Version information: app version, public API version, applied database schema revision."""

from __future__ import annotations

import contextlib
from typing import TYPE_CHECKING

from sqlalchemy import text

import jarvis

if TYPE_CHECKING:  # pragma: no cover
    from jarvis.core.container import AppContext

API_VERSION = "v1"


async def schema_revision(app: "AppContext") -> str | None:
    with contextlib.suppress(Exception):
        async with app.sessionmaker() as session:
            return (await session.execute(text("SELECT version_num FROM alembic_version"))).scalar_one_or_none()
    return None


async def version_info(app: "AppContext") -> dict:
    return {"app": jarvis.__version__, "api": API_VERSION, "schema": await schema_revision(app)}
