"""Shell execution in the sandbox container."""

from __future__ import annotations

from pydantic import BaseModel, Field

from jarvis.tools.base import Risk, ToolContext, tool


class ExecArgs(BaseModel):
    command: str = Field(min_length=1, max_length=20000, description="bash command, runs in /workspace")
    timeout_s: int = Field(60, ge=1, le=600)
    workdir: str = ""


@tool(name="sandbox_exec", description="Run a shell command in the isolated sandbox and return stdout/stderr.",
      risk=Risk.WRITE, activity="Выполняю код", requires=("sandbox",), timeout_s=660, idempotent=False,
      parallel_safe=False, summarize=lambda a: f"$ {str(a.get('command'))[:200]}")
async def sandbox_exec(ctx: ToolContext, args: ExecArgs) -> dict:
    return await ctx.app.sandbox.exec(args.command, timeout_s=args.timeout_s, workdir=args.workdir)
