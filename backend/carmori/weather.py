"""Open-Meteo 현재 날씨. 실패하면 None을 돌려주고 브리핑에서 빼기만 한다."""

from __future__ import annotations

from datetime import datetime

import httpx
from pydantic import BaseModel

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"


class WeatherNow(BaseModel):
    temperature_c: float
    precipitation_mm: float
    observed_at: datetime


async def fetch_weather(lat: float, lon: float, *, timeout_s: float = 3.0) -> WeatherNow | None:
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": "temperature_2m,precipitation",
        "timezone": "auto",
    }
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.get(OPEN_METEO_URL, params=params)
            resp.raise_for_status()
            current = resp.json()["current"]
        return WeatherNow(
            temperature_c=current["temperature_2m"],
            precipitation_mm=current["precipitation"],
            observed_at=datetime.fromisoformat(current["time"]),
        )
    except (httpx.HTTPError, KeyError, ValueError):
        return None
