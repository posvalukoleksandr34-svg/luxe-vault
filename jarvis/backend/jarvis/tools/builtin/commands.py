"""Custom commands (user macros) as agent tools: list, run by name, create from a conversation."""

from __future__ import annotations

from pydantic import BaseModel, Field

from jarvis.commands.service import CommandError, CommandIn, Step, serialize
from jarvis.tools.base import Risk, ToolContext, ToolError, tool


class NoArgs(BaseModel):
    pass


@tool(name="command_list", description="List the user's custom commands (macros) with their trigger phrases.",
      activity="Смотрю команды")
async def command_list(ctx: ToolContext, args: NoArgs) -> dict:
    rows = await ctx.app.commands.list(ctx.user_id)
    return {"commands": [{"name": c.name, "triggers": c.triggers, "enabled": c.enabled, "steps": len(c.steps),
                          "last_status": c.last_status} for c in rows]}


class RunArgs(BaseModel):
    name: str = Field(description="Command name or one of its trigger phrases")


@tool(name="command_run", description="Run one of the user's custom commands (e.g. 'Gaming mode'). Use when the user "
      "asks for a command by a slightly different phrase than its trigger.", risk=Risk.WRITE,
      activity="Запускаю команду", parallel_safe=False)
async def command_run(ctx: ToolContext, args: RunArgs) -> dict:
    cmd = await ctx.app.commands.find(ctx.user_id, args.name)
    if cmd is None:
        raise ToolError(f"no command called '{args.name}'", hint="call command_list to see the user's commands")
    if not cmd.enabled:
        raise ToolError(f"command '{cmd.name}' is disabled")
    task = await ctx.app.commands.start(ctx.user_id, cmd, channel=ctx.channel, conversation_id=ctx.conversation_id)
    return {"started": cmd.name, "task_id": str(task.id), "note": "the command reports its own result"}


class CreateArgs(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    triggers: list[str] = Field(min_length=1, max_length=10,
                                description="Phrases that start it, e.g. ['игровой режим', 'включи игровой режим']")
    steps: list[Step] = Field(min_length=1, max_length=25, description=(
        "In order. {type:'tool', tool:'computer_open_app', args:{name:'spotify'}} | {type:'wait', seconds:2} | "
        "{type:'say', text:'…'} | {type:'notify', text:'…'} | {type:'agent', text:'prompt for JARVIS'}. "
        "Optional per step: when (always|device_online|weekday|weekend|morning|evening), continue_on_error."))
    response: str = Field("", max_length=500, description="What JARVIS says when all steps succeed")
    description: str = Field("", max_length=500)


@tool(name="command_create", description="Create or replace a custom command (a macro the user can trigger by "
      "phrase). Tool steps must be existing tools with valid arguments.", risk=Risk.WRITE, activity="Создаю команду")
async def command_create(ctx: ToolContext, args: CreateArgs) -> dict:
    body = CommandIn(name=args.name, triggers=args.triggers, steps=args.steps, response=args.response,
                     description=args.description, preapproved=False)  # the agent can never pre-approve
    existing = await ctx.app.commands.find(ctx.user_id, args.name)
    try:
        row, warnings = await ctx.app.commands.save(ctx.user_id, body, elevated=False,
                                                    command_id=existing.id if existing else None)
    except CommandError as exc:
        raise ToolError(str(exc)) from exc
    return {"command": serialize(row), "warnings": warnings}
