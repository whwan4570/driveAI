from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import httpx
from fastapi.testclient import TestClient

from carmori.config import Settings
from carmori.main import create_app
from carmori.spark import HappyPathSpark
from carmori.weather import EnvironmentContext, OpenMeteoEnvironment


class RecordingWeather:
    def __init__(self) -> None:
        self.calls: list[tuple[str | None, tuple[float, float] | None]] = []

    async def get(self, region: str | None, coords: tuple[float, float] | None = None) -> EnvironmentContext:
        self.calls.append((region, coords))
        if coords is None:
            return EnvironmentContext(area=region)
        return EnvironmentContext(status="available", rainfall_mm=14.0, last_successful_update=datetime.now(timezone.utc))


def setup(tmp_path):
    weather = RecordingWeather()
    client = TestClient(create_app(Settings(db_path=str(tmp_path / "gps.sqlite")), spark=HappyPathSpark(), environment_provider=weather))
    vid = client.post("/vehicles", json={"spec_id": "demo", "year": 2021, "make": "Honda", "model": "Civic"}).json()["vehicle_id"]
    return client, weather, vid


def test_gps_summary_sets_weekly_miles_and_rounded_location(tmp_path):
    client, _, vid = setup(tmp_path)
    vehicle = client.put(f"/vehicles/{vid}/driving-summary", json={
        "weekly_miles": 231.46, "highway_percent": 38, "lat": 37.774929, "lon": -122.419416,
    }).json()
    assert vehicle["weekly_miles"] == 231.5 and vehicle["highway_percent"] == 38
    assert vehicle["driving_source"] == "gps" and vehicle["driving_updated_at"]
    assert (vehicle["location_lat"], vehicle["location_lon"]) == (37.77, -122.42)


def test_location_only_update_keeps_driving_data(tmp_path):
    client, _, vid = setup(tmp_path)
    client.put(f"/vehicles/{vid}/driving-summary", json={"weekly_miles": 120, "highway_percent": 10})
    vehicle = client.put(f"/vehicles/{vid}/driving-summary", json={"lat": 47.61, "lon": -122.33}).json()
    assert vehicle["weekly_miles"] == 120 and vehicle["location_lat"] == 47.61
    assert client.put(f"/vehicles/{vid}/driving-summary", json={}).status_code == 422


def test_gps_data_drives_care_weather_and_briefing(tmp_path):
    client, weather, vid = setup(tmp_path)
    client.put(f"/vehicles/{vid}/driving-summary", json={"weekly_miles": 240, "highway_percent": 50, "lat": 47.61, "lon": -122.33})
    care = client.get(f"/vehicles/{vid}/care-recommendations").json()
    assert weather.calls[-1] == (None, (47.61, -122.33))
    washer = next(item for item in care["recommendations"] if item["component"] == "washer_fluid")
    tires = next(item for item in care["recommendations"] if item["component"] == "tires")
    assert washer["priority"] == "CHECK_SOON"
    assert tires["priority"] == "CHECK_SOON" and "Phone GPS tracked" in tires["explanation"]
    assert any(e["source"] == "phone_gps" for e in tires["evidence"])
    facts = client.post("/briefings", json={"vehicle_id": vid}).json()["facts"]
    driving = next(f for f in facts if f["id"] == "driving_profile")
    assert driving["text"] == "Phone GPS tracked 240 miles in the past 7 days and an estimated 50% highway share."


def test_manual_edit_marks_driving_source_manual(tmp_path):
    client, _, vid = setup(tmp_path)
    client.put(f"/vehicles/{vid}/driving-summary", json={"weekly_miles": 90})
    vehicle = client.patch(f"/vehicles/{vid}", json={"weekly_miles": 150}).json()
    assert vehicle["driving_source"] == "manual"


def test_open_meteo_uses_coordinates_without_geocoding(monkeypatch):
    requested: list[str] = []

    class FakeClient:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass

        async def get(self, url, params=None):
            requested.append(url)
            body = {"daily": {"time": ["d1", "d2", "today"], "rain_sum": [3.0, 4.5, 0.0]}}
            return httpx.Response(200, json=body, request=httpx.Request("GET", url))

    monkeypatch.setattr("carmori.weather.httpx.AsyncClient", FakeClient)
    result = asyncio.run(OpenMeteoEnvironment().get(None, (47.61, -122.33)))
    assert result.status == "available" and result.rainfall_mm == 7.5 and result.area is None
    assert all("geocoding" not in url for url in requested)
