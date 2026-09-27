"""Workspace file tools (confined to the data volume)."""

from __future__ import annotations

from pydantic import BaseModel, Field

from jarvis.tools.base import Risk, ToolContext, tool


class ListArgs(BaseModel):
    path: str = ""
    recursive: bool = False


@tool(name="files_list", description="List files and folders in the workspace.", activity="Смотрю файлы")
async def files_list(ctx: ToolContext, args: ListArgs) -> dict:
    return {"items": ctx.app.files.list(args.path, recursive=args.recursive)}


class ReadArgs(BaseModel):
    path: str
    max_chars: int = Field(60000, ge=1000, le=200000)


@tool(name="files_read", description="Read a file as text (PDF, DOCX, Markdown, CSV, code…).", activity="Читаю файл",
      untrusted_output=True, max_output_chars=60000)
async def files_read(ctx: ToolContext, args: ReadArgs) -> dict:
    return ctx.app.files.read_text(args.path, max_chars=args.max_chars)


class WriteArgs(BaseModel):
    path: str = Field(description="Relative path, e.g. reports/2026-09-28-summary.md")
    content: str = Field(max_length=2_000_000)
    overwrite: bool = True


@tool(name="files_write", description="Create or overwrite a text file in the workspace.", risk=Risk.WRITE,
      activity="Сохраняю файл", idempotent=True, summarize=lambda a: f"Записать файл {a.get('path')}")
async def files_write(ctx: ToolContext, args: WriteArgs) -> dict:
    return ctx.app.files.write_text(args.path, args.content, overwrite=args.overwrite)


class MoveArgs(BaseModel):
    source: str
    destination: str


@tool(name="files_move", description="Move or rename a file/folder.", risk=Risk.WRITE, activity="Перемещаю файл")
async def files_move(ctx: ToolContext, args: MoveArgs) -> dict:
    return ctx.app.files.move(args.source, args.destination)


class DeleteArgs(BaseModel):
    path: str


@tool(name="files_delete", description="Delete a file or folder (moved to .trash, recoverable).", risk=Risk.WRITE,
      activity="Удаляю файл", summarize=lambda a: f"Удалить {a.get('path')}")
async def files_delete(ctx: ToolContext, args: DeleteArgs) -> dict:
    ctx.app.files.delete(args.path)
    return {"deleted": args.path, "recoverable_from": ".trash/"}


class SearchArgs(BaseModel):
    query: str = Field(min_length=2)
    path: str = ""


@tool(name="files_search", description="Find files by name or content.", activity="Ищу в файлах")
async def files_search(ctx: ToolContext, args: SearchArgs) -> dict:
    return {"matches": ctx.app.files.search(args.query, rel=args.path)}
