import pytest

from jarvis.integrations.browser import BrowserPool
from jarvis.tools.base import ToolError


async def test_browser_unavailable_without_endpoint():
    pool = BrowserPool(None)
    assert not pool.available
    with pytest.raises(ToolError, match="browser service is not running"):
        await pool.page(__import__("uuid").uuid4())


async def test_browser_refuses_internal_urls():
    pool = BrowserPool("ws://browser:3000/")
    with pytest.raises(ToolError, match="URL not allowed"):
        await pool.open(__import__("uuid").uuid4(), "http://169.254.169.254/latest")
