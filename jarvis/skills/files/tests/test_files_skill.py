import io
import zipfile

import pytest

from jarvis.integrations.files import FileStore, extract_text
from jarvis.tools.base import ToolError


def test_path_confinement(tmp_path):
    fs = FileStore(tmp_path / "ws")
    for bad in ("../etc/passwd", "/../../x", "a/../../b"):
        with pytest.raises(ToolError):
            fs.path(bad)
    assert fs.path("reports/a.md").is_relative_to(fs.root)


def test_write_read_search_delete(tmp_path):
    fs = FileStore(tmp_path / "ws")
    fs.write_text("notes/idea.md", "# Идея\nСделать JARVIS")
    assert fs.read_text("notes/idea.md")["content"].startswith("# Идея")
    hits = fs.search("jarvis")
    assert hits and hits[0]["path"] == "notes/idea.md"
    fs.delete("notes/idea.md")
    assert not (fs.root / "notes/idea.md").exists()
    assert any((fs.root / ".trash").rglob("idea.md"))


def test_docx_extraction():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", "<w:document><w:body><w:p><w:r><w:t>Привет</w:t></w:r></w:p>"
                                        "<w:p><w:r><w:t>мир</w:t></w:r></w:p></w:body></w:document>")
    assert extract_text("a.docx", buf.getvalue()).split() == ["Привет", "мир"]
