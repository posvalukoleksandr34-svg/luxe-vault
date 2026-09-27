import httpx
import pytest

from jarvis.integrations.web import fetch_page, html_to_text
from jarvis.security.ssrf import UnsafeURLError, assert_public_url
from jarvis.tools.base import ToolError


def test_html_to_text_drops_chrome():
    html = "<html><head><title>T</title><script>x()</script></head><body><nav>menu</nav>" \
           "<article><h1>Hello</h1><p>World</p></article><footer>f</footer></body></html>"
    title, text = html_to_text(html)
    assert title == "T"
    assert "Hello" in text and "World" in text
    assert "menu" not in text and "x()" not in text


@pytest.mark.parametrize("url", [
    "http://localhost/admin", "http://127.0.0.1:8000", "http://10.0.0.5/", "http://169.254.169.254/latest/meta-data",
    "http://postgres:5432", "file:///etc/passwd", "http://[::1]/", "http://100.64.1.1/", "http://user:pw@example.com",
])
async def test_ssrf_guard_blocks_internal_targets(url):
    with pytest.raises(UnsafeURLError):
        await assert_public_url(url, resolve=False)


async def test_fetch_page_extracts_text_with_mock_transport(monkeypatch):
    async def fake_assert(url, resolve=True):
        return url

    monkeypatch.setattr("jarvis.integrations.web.assert_public_url", fake_assert)
    transport = httpx.MockTransport(lambda req: httpx.Response(
        200, headers={"content-type": "text/html; charset=utf-8"},
        text="<html><title>Doc</title><body><main>Главное содержание</main></body></html>"))
    page = await fetch_page("https://example.org/x", transport=transport)
    assert page["title"] == "Doc"
    assert "Главное содержание" in page["content"]


async def test_fetch_page_blocks_redirect_to_internal(monkeypatch):
    calls = []

    async def fake_assert(url, resolve=True):
        calls.append(url)
        if "169.254" in url:
            raise UnsafeURLError("internal")
        return url

    monkeypatch.setattr("jarvis.integrations.web.assert_public_url", fake_assert)
    transport = httpx.MockTransport(lambda req: httpx.Response(302, headers={"location": "http://169.254.169.254/"}))
    with pytest.raises(ToolError, match="redirect blocked"):
        await fetch_page("https://example.org/", transport=transport)
