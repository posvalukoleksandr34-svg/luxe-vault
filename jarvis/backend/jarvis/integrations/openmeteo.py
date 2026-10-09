"""Open-Meteo (free, no key): geocode a place and fetch current weather + a daily forecast.

Shared by the weather skill (tool for the model) and the desktop widget (`GET /api/weather`).
"""

from __future__ import annotations

import httpx

from jarvis.tools.base import ToolError

GEO = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST = "https://api.open-meteo.com/v1/forecast"
CODES = {0: "ясно", 1: "преимущественно ясно", 2: "переменная облачность", 3: "пасмурно", 45: "туман", 48: "изморозь",
         51: "морось", 61: "небольшой дождь", 63: "дождь", 65: "сильный дождь", 71: "небольшой снег", 73: "снег",
         75: "сильный снег", 80: "ливень", 81: "ливни", 82: "сильные ливни", 95: "гроза", 96: "гроза с градом"}


async def forecast(location: str, days: int = 3, *, transport: httpx.AsyncBaseTransport | None = None) -> dict:
    async with httpx.AsyncClient(timeout=15, transport=transport) as client:
        geo = (await client.get(GEO, params={"name": location, "count": 1, "language": "ru"})).json()
        if not geo.get("results"):
            raise ToolError(f"place not found: {location}")
        place = geo["results"][0]
        r = await client.get(FORECAST, params={
            "latitude": place["latitude"], "longitude": place["longitude"], "timezone": "auto",
            "current": "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day",
            "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
            "forecast_days": days})
        if r.status_code >= 400:
            raise ToolError("weather service unavailable", retryable=True)
        data = r.json()
    cur, daily = data["current"], data["daily"]
    return {
        "place": f"{place['name']}, {place.get('country', '')}".strip(", "),
        "now": {"temp_c": cur["temperature_2m"], "feels_like_c": cur["apparent_temperature"],
                "conditions": CODES.get(cur["weather_code"], str(cur["weather_code"])), "code": cur["weather_code"],
                "wind_kmh": cur["wind_speed_10m"], "is_day": bool(cur.get("is_day", 1))},
        "days": [{"date": d, "min_c": lo, "max_c": hi, "precip_prob": p, "conditions": CODES.get(c, str(c))}
                 for d, lo, hi, p, c in zip(daily["time"], daily["temperature_2m_min"], daily["temperature_2m_max"],
                                            daily["precipitation_probability_max"], daily["weather_code"])],
    }
