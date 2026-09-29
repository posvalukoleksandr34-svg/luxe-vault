"""Google Drive tools (read-only scope + files created by JARVIS)."""

from __future__ import annotations

import json

from pydantic import BaseModel, Field

from jarvis.integrations.files import extract_text
from jarvis.integrations.google.client import GoogleAPI
from jarvis.tools.base import Risk, ToolContext, ToolError, tool

DRIVE = "https://www.googleapis.com/drive/v3"
UPLOAD = "https://www.googleapis.com/upload/drive/v3/files"
EXPORT = {
    "application/vnd.google-apps.document": "text/plain",
    "application/vnd.google-apps.spreadsheet": "text/csv",
    "application/vnd.google-apps.presentation": "text/plain",
}


class SearchArgs(BaseModel):
    query: str = Field(min_length=1)
    limit: int = Field(10, ge=1, le=50)


@tool(name="drive_search", description="Search Google Drive by name and content.", activity="Ищу в Google Drive",
      requires=("google",), timeout_s=30, retries=1)
async def drive_search(ctx: ToolContext, args: SearchArgs) -> dict:
    q = args.query.replace("\\", "\\\\").replace("'", "\\'")
    data = await GoogleAPI(ctx.app, ctx.user_id).request("GET", f"{DRIVE}/files", params={
        "q": f"(name contains '{q}' or fullText contains '{q}') and trashed = false",
        "pageSize": str(args.limit), "fields": "files(id,name,mimeType,modifiedTime,webViewLink,size)",
        "orderBy": "modifiedTime desc"})
    return {"files": data.get("files", [])}


class ReadArgs(BaseModel):
    file_id: str
    max_chars: int = Field(60000, ge=1000, le=200000)


@tool(name="drive_read", description="Read a Drive file as text.", activity="Читаю документ из Drive",
      requires=("google",), untrusted_output=True, timeout_s=60, retries=1)
async def drive_read(ctx: ToolContext, args: ReadArgs) -> dict:
    api = GoogleAPI(ctx.app, ctx.user_id)
    meta = await api.request("GET", f"{DRIVE}/files/{args.file_id}", params={"fields": "id,name,mimeType,size"})
    mime = meta.get("mimeType", "")
    if mime in EXPORT:
        raw = await api.request("GET", f"{DRIVE}/files/{args.file_id}/export", params={"mimeType": EXPORT[mime]},
                                raw=True)
        text = raw.decode("utf-8", errors="replace")
    elif mime.startswith("application/vnd.google-apps"):
        raise ToolError(f"cannot read {mime}")
    else:
        if int(meta.get("size") or 0) > 30 * 1024 * 1024:
            raise ToolError("file too large")
        raw = await api.request("GET", f"{DRIVE}/files/{args.file_id}", params={"alt": "media"}, raw=True)
        text = extract_text(meta.get("name", "file"), raw)
    return {"name": meta.get("name"), "mime": mime, "content": text[: args.max_chars],
            "truncated": len(text) > args.max_chars}


class UploadArgs(BaseModel):
    path: str = Field(description="Workspace file to upload")
    name: str | None = None


@tool(name="drive_upload", description="Upload a workspace file to Google Drive.", risk=Risk.EXTERNAL,
      activity="Загружаю в Google Drive", requires=("google",), idempotent=False, timeout_s=120,
      summarize=lambda a: f"Загрузить {a.get('path')} в Google Drive")
async def drive_upload(ctx: ToolContext, args: UploadArgs) -> dict:
    p = (await ctx.app.user_files(ctx.user_id)).path(args.path)
    if not p.is_file():
        raise ToolError(f"{args.path} is not a file")
    meta = {"name": args.name or p.name}
    boundary = "jarvis-boundary"
    body = (f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{json.dumps(meta)}\r\n"
            f"--{boundary}\r\nContent-Type: application/octet-stream\r\n\r\n").encode() + p.read_bytes() + \
        f"\r\n--{boundary}--".encode()
    data = await GoogleAPI(ctx.app, ctx.user_id).request(
        "POST", UPLOAD, params={"uploadType": "multipart", "fields": "id,name,webViewLink"}, content=body,
        headers={"Content-Type": f"multipart/related; boundary={boundary}"})
    return data
