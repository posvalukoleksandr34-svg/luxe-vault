"""The user's file workspace (/data/files) with path confinement and text extraction."""

from __future__ import annotations

import io
import mimetypes
import os
import re
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pypdf import PdfReader

from jarvis.tools.base import ToolError

TEXT_EXT = {".txt", ".md", ".csv", ".json", ".yaml", ".yml", ".py", ".js", ".ts", ".html", ".xml", ".log", ".ini",
            ".toml", ".sql", ".sh", ".css", ".tsx", ".jsx"}
MAX_READ = 2_000_000


TENANTS = "tenants"  # <root>/tenants/<user_id>: workspaces of non-owner accounts


class FileStore:
    """One workspace. The instance owner uses the root (backwards compatible with single-user installs); every
    other account gets `<root>/tenants/<user_id>` via `for_tenant`, and the owner's store refuses that subtree,
    so no account can reach another account's files."""

    def __init__(self, root: Path, *, reserved: tuple[str, ...] = (TENANTS,)):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.reserved = reserved

    def for_tenant(self, user_id: object) -> "FileStore":
        return FileStore(self.root / TENANTS / str(user_id), reserved=())

    def _hidden(self, p: Path) -> bool:
        if not self.reserved or p == self.root:
            return False
        return p.relative_to(self.root).parts[0] in self.reserved

    def path(self, rel: str) -> Path:
        rel = (rel or "").strip().lstrip("/")
        target = (self.root / rel).resolve()
        if target != self.root and self.root not in target.parents:
            raise ToolError("path escapes the workspace")
        if self._hidden(target):
            raise ToolError("path escapes the workspace")
        return target

    def rel(self, p: Path) -> str:
        return str(p.resolve().relative_to(self.root)) or "."

    def info(self, p: Path) -> dict[str, Any]:
        st = p.stat()
        return {"path": self.rel(p), "type": "dir" if p.is_dir() else "file", "size": st.st_size,
                "modified": datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat(timespec="seconds"),
                "mime": mimetypes.guess_type(p.name)[0] if p.is_file() else None}

    def list(self, rel: str = "", *, recursive: bool = False, limit: int = 200) -> list[dict[str, Any]]:
        base = self.path(rel)
        if not base.exists():
            raise ToolError(f"{rel or '/'} does not exist")
        it = base.rglob("*") if recursive else base.iterdir()
        items = []
        for p in sorted(it):
            if p.name.startswith(".") or self._hidden(p):
                continue
            items.append(self.info(p))
            if len(items) >= limit:
                break
        return items

    def read_text(self, rel: str, *, max_chars: int = 60000) -> dict[str, Any]:
        p = self.path(rel)
        if not p.is_file():
            raise ToolError(f"{rel} is not a file")
        if p.stat().st_size > 50 * 1024 * 1024:
            raise ToolError("file too large to read")
        text = extract_text(p.name, p.read_bytes())
        truncated = len(text) > max_chars
        return {"path": self.rel(p), "content": text[:max_chars], "truncated": truncated, "chars": len(text)}

    def write_text(self, rel: str, content: str, *, overwrite: bool = True) -> dict[str, Any]:
        p = self.path(rel)
        if p.exists() and not overwrite:
            raise ToolError(f"{rel} already exists")
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(p.suffix + ".tmp")
        tmp.write_text(content, encoding="utf-8")
        os.replace(tmp, p)
        return self.info(p)

    def write_bytes(self, rel: str, data: bytes) -> dict[str, Any]:
        p = self.path(rel)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        return self.info(p)

    def move(self, src: str, dst: str) -> dict[str, Any]:
        a, b = self.path(src), self.path(dst)
        if not a.exists():
            raise ToolError(f"{src} does not exist")
        b.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(a), str(b))
        return self.info(b)

    def delete(self, rel: str) -> None:
        p = self.path(rel)
        if p == self.root:
            raise ToolError("refusing to delete the workspace root")
        if not p.exists():
            raise ToolError(f"{rel} does not exist")
        trash = self.root / ".trash" / datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        trash.mkdir(parents=True, exist_ok=True)
        shutil.move(str(p), str(trash / p.name))  # recoverable for the retention period

    def search(self, query: str, *, rel: str = "", limit: int = 30) -> list[dict[str, Any]]:
        base = self.path(rel)
        q = query.lower()
        out = []
        for p in base.rglob("*"):
            if not p.is_file() or ".trash" in p.parts or p.name.startswith(".") or self._hidden(p):
                continue
            hit = {"path": self.rel(p), "match": "name"} if q in p.name.lower() else None
            if hit is None and p.suffix.lower() in TEXT_EXT | {".pdf", ".docx"} and p.stat().st_size < 5_000_000:
                try:
                    text = extract_text(p.name, p.read_bytes())
                except Exception:  # noqa: BLE001
                    continue
                idx = text.lower().find(q)
                if idx >= 0:
                    hit = {"path": self.rel(p), "match": "content",
                           "snippet": text[max(0, idx - 80): idx + 120].replace("\n", " ")}
            if hit:
                out.append(hit)
                if len(out) >= limit:
                    break
        return out


def extract_text(name: str, data: bytes) -> str:
    ext = Path(name).suffix.lower()
    if ext == ".pdf":
        reader = PdfReader(io.BytesIO(data))
        return "\n\n".join((page.extract_text() or "") for page in reader.pages[:300])
    if ext == ".docx":
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            xml = z.read("word/document.xml").decode("utf-8", errors="replace")
        xml = re.sub(r"</w:p>", "\n", xml)
        return re.sub(r"<[^>]+>", "", xml)
    if ext in TEXT_EXT or not ext:
        return data[:MAX_READ].decode("utf-8", errors="replace")
    raise ToolError(f"cannot extract text from {ext} files")
