import sys
import uuid

import httpx
import pytest


def _handler(req: httpx.Request) -> httpx.Response:
    if "geocoding" in req.url.host:
        return httpx.Response(200, json={"results": [{"name": "Berlin", "country": "Germany", "latitude": 52.5,
                                                      "longitude": 13.4}]})
    return httpx.Response(200, json={
        "current": {"temperature_2m": 14.2, "apparent_temperature": 12.9, "weather_code": 3, "wind_speed_10m": 11},
        "daily": {"time": ["2026-09-28"], "temperature_2m_min": [9.1], "temperature_2m_max": [17.4],
                  "precipitation_probability_max": [40], "weather_code": [61]}})


@pytest.fixture
def weather_module():
    from jarvis.skills.manager import SkillManager
    from pathlib import Path
    from jarvis.tools.registry import ToolRegistry

    mgr = SkillManager(Path(__file__).parents[2], ToolRegistry(), None)
    mgr.discover()
    mod = sys.modules["jarvis_skill_weather"]
    mod.TRANSPORT = httpx.MockTransport(_handler)
    yield mgr.registry.get("weather_forecast")
    mod.TRANSPORT = None


async def test_weather_forecast_shapes_result(weather_module):
    from jarvis.tools.base import ToolContext

    ctx = ToolContext(app=None, user_id=uuid.uuid4())
    out = await weather_module.fn(ctx, weather_module.input_model(location="Berlin", days=1))
    assert out["place"] == "Berlin, Germany"
    assert out["now"]["conditions"] == "пасмурно"
    assert out["days"][0]["conditions"] == "небольшой дождь"
