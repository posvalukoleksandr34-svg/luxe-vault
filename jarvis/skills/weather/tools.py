"""Weather via Open-Meteo (free, no key). A complete, minimal example of an API-backed skill:
geocode → forecast → compact structured result."""

from __future__ import annotations

import httpx
from pydantic import BaseModel, Field

from jarvis.integrations.openmeteo import forecast
from jarvis.tools.base import ToolContext, tool

TRANSPORT: httpx.AsyncBaseTransport | None = None  # tests inject a mock transport


class WeatherArgs(BaseModel):
    location: str = Field(description="City or place name, e.g. 'Berlin' or 'Киев'")
    days: int = Field(3, ge=1, le=7)


@tool(name="weather_forecast", description="Current weather and daily forecast for a location.",
      activity="Смотрю погоду", timeout_s=20, retries=2)
async def weather_forecast(ctx: ToolContext, args: WeatherArgs) -> dict:
    return await forecast(args.location, args.days, transport=TRANSPORT)
