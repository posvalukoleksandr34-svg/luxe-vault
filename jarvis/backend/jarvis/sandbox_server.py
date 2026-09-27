"""Sandbox service: runs shell commands for the coding agent inside its own container.

Isolation comes from the container (non-root user, read-only root filesystem,
dropped capabilities, CPU/memory/PID limits, no route to core services, egress
optional). This process adds: bearer-token auth, per-command timeout, output
caps, a confined working directory and a small deny-list for obviously
destructive patterns.

Run: uvicorn jarvis.sandbox_server:app --host 0.0.0.0 --port 8090
"""

from __future__ import annotations

import asyncio
import hmac
import os
import re
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

WORKSPACE = Path(os.environ.get("SANDBOX_WORKSPACE", "/workspace")).resolve()
TOKEN = os.environ.get("SANDBOX_TOKEN", "")
MAX_OUTPUT = 64_000
DENY = [re.compile(p) for p in (r"\brm\s+-rf\s+/(\s|$)", r":\(\)\s*\{\s*:\|:&\s*\};:", r"\bmkfs\b", r"\bdd\s+if=/dev/")]

app = FastAPI(title="JARVIS sandbox", docs_url=None, redoc_url=None)


class ExecRequest(BaseModel):
    command: str = Field(min_length=1, max_length=20000)
    timeout: int = Field(60, ge=1, le=600)
    workdir: str = ""


@app.get("/health")
async def health() -> dict:
    return {"ok": True}


@app.post("/exec")
async def exec_command(req: ExecRequest, authorization: str = Header(default="")) -> dict:
    if not TOKEN or not hmac.compare_digest(authorization, f"Bearer {TOKEN}"):
        raise HTTPException(401, "unauthorized")
    if any(p.search(req.command) for p in DENY):
        raise HTTPException(400, "command rejected by sandbox policy")
    cwd = (WORKSPACE / req.workdir.lstrip("/")).resolve()
    if cwd != WORKSPACE and WORKSPACE not in cwd.parents:
        raise HTTPException(400, "workdir escapes the workspace")
    cwd.mkdir(parents=True, exist_ok=True)
    proc = await asyncio.create_subprocess_exec(
        "/bin/bash", "-lc", req.command, cwd=str(cwd), stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE, env={"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": str(WORKSPACE),
                                             "LANG": "C.UTF-8", "PYTHONUNBUFFERED": "1"},
        start_new_session=True,
    )
    timed_out = False
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=req.timeout)
    except asyncio.TimeoutError:
        timed_out = True
        try:
            os.killpg(proc.pid, 9)
        except ProcessLookupError:
            pass
        out, err = await proc.communicate()
    return {
        "exit_code": proc.returncode, "timed_out": timed_out,
        "stdout": out.decode(errors="replace")[-MAX_OUTPUT:], "stderr": err.decode(errors="replace")[-MAX_OUTPUT:],
    }
