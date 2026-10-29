"""Open-Meteo weather context. Failed lookups stay explicitly unavailable."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Protocol

import httpx
from pydantic import BaseModel

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"


class EnvironmentContext(BaseModel):
    status: Literal["available", "unavailable"] = "unavailable"
    provider: str = "Open-Meteo"
    area: str | None = None
    time_window: str | None = None
    last_successful_update: datetime | None = None
    rainfall_mm: float | None = None
    forecast_low_c: float | None = None


class EnvironmentProvider(Protocol):
    async def get(self, region: str | None, coords: tuple[float, float] | None = None) -> EnvironmentContext: ...


class OpenMeteoEnvironment:
    def __init__(self) -> None:
        self._cache: dict[str, tuple[datetime, EnvironmentContext]] = {}

    async def get(self, region: str | None, coords: tuple[float, float] | None = None) -> EnvironmentContext:
        # GPS coordinates win over a typed region; area stays None for GPS lookups.
        if coords is None and not region:
            return EnvironmentContext(area=None)
        key = f"gps:{coords[0]:.2f},{coords[1]:.2f}" if coords else f"region:{region}"
        now = datetime.now(timezone.utc)
        cached = self._cache.get(key)
        if cached and (now - cached[0]).total_seconds() < 900:
            return cached[1]
        unavailable = EnvironmentContext(area=None if coords else region)
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                if coords:
                    place: dict = {"latitude": coords[0], "longitude": coords[1]}
                else:
                    place_response = await client.get(GEOCODING_URL, params={"name": region, "count": 1})
                    place_response.raise_for_status()
                    places = place_response.json().get("results") or []
                    if not places:
                        return unavailable
                    place = places[0]
                weather_response = await client.get(OPEN_METEO_URL, params={
                    "latitude": place["latitude"], "longitude": place["longitude"],
                    "daily": "rain_sum,temperature_2m_min", "past_days": 7, "forecast_days": 1, "timezone": "auto",
                })
                weather_response.raise_for_status()
                daily = weather_response.json()["daily"]
            days, rain = daily["time"][:-1], daily["rain_sum"][:-1]
            if not days or len(days) != len(rain) or any(value is None for value in rain):
                return unavailable
            forecast_lows = daily.get("temperature_2m_min") or []
            forecast_low = forecast_lows[-1] if forecast_lows and isinstance(forecast_lows[-1], (int, float)) else None
            area = ", ".join(str(item) for item in (place.get("name"), place.get("admin1"), place.get("country_code")) if item) or None
            result = EnvironmentContext(status="available", area=area,
                                        time_window=f"{days[0]} to {days[-1]}",
                                        last_successful_update=now, rainfall_mm=round(sum(rain), 1),
                                        forecast_low_c=forecast_low)
            self._cache[key] = (now, result)
            return result
        except (httpx.HTTPError, KeyError, TypeError, ValueError, IndexError):
            return unavailable


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
