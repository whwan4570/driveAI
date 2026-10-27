from __future__ import annotations

from datetime import datetime, timezone
import base64
import asyncio

import httpx

from fastapi.testclient import TestClient

from carmori.config import Settings
from carmori.main import create_app
from carmori.spark import HappyPathSpark
from carmori.weather import EnvironmentContext, OpenMeteoEnvironment
from carmori.care import calculate_recommendations
from carmori.briefing import build_facts, render_memory_answer
from carmori.models import CompletionSource, MaintenanceRecord, VehicleProfile
from carmori.vehicles import DEMO_SPEC


class NoWeather:
    async def get(self, region: str | None, coords: tuple[float, float] | None = None) -> EnvironmentContext:
        return EnvironmentContext(area=region)


def client_for(path) -> TestClient:
    return TestClient(create_app(Settings(db_path=str(path)), spark=HappyPathSpark(), environment_provider=NoWeather()))


def create_vehicle(client: TestClient, weekly_miles: int) -> dict:
    response = client.post("/vehicles", json={
        "spec_id": "demo", "year": 2021, "make": "Honda", "model": "Civic",
        "odometer_km": 80000, "region": "San Francisco, CA",
        "weekly_miles": weekly_miles, "highway_percent": 40,
    })
    assert response.status_code == 200
    return response.json()


def recommendations(client: TestClient, vehicle_id: str) -> dict:
    response = client.get(f"/vehicles/{vehicle_id}/care-recommendations")
    assert response.status_code == 200
    return response.json()


def test_vehicle_profile_and_records_survive_server_restart(tmp_path):
    path = tmp_path / "carmori.sqlite"
    first = client_for(path)
    vehicle = create_vehicle(first, 240)
    vid = vehicle["vehicle_id"]
    assert vehicle["odometer_km"] == 80000
    updated = first.patch(f"/vehicles/{vid}", json={"odometer_km": 80500, "weekly_miles": 260}).json()
    assert updated["odometer_updated_at"] and updated["weekly_miles"] == 260
    assert updated["driving_updated_at"]
    saved = first.post("/maintenance-records", json={
        "vehicle_id": vid, "component": "washer_fluid", "event_type": "refill",
        "completed_at": datetime.now(timezone.utc).isoformat(), "user_confirmed": True,
        "photo_data_url": "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8photo\xff\xd9").decode(),
    })
    assert saved.status_code == 200

    second = client_for(path)
    assert second.get(f"/vehicles/{vid}").json()["odometer_km"] == 80500
    persisted = second.get(f"/vehicles/{vid}/memory").json()
    assert len(persisted) == 1 and persisted[0]["photo_data_url"].startswith("data:image/jpeg;base64,")
    care = recommendations(second, vid)
    washer = next(item for item in care["recommendations"] if item["component"] == "washer_fluid")
    assert washer["priority"] == "ROUTINE"
    assert washer["evidence"][-1]["record_id"] == saved.json()["record_id"]


def test_vehicle_nickname_persists(tmp_path):
    path = tmp_path / "nickname.sqlite"
    first = client_for(path)
    created = first.post("/vehicles", json={
        "spec_id": "demo", "year": 2021, "make": "Honda", "model": "Civic",
        "odometer_km": 80000, "region": "San Francisco, CA",
        "weekly_miles": 90, "highway_percent": 40,
        "nickname": "Sunny",
    })
    assert created.status_code == 200
    vehicle = created.json()
    assert vehicle["nickname"] == "Sunny"
    changed = first.patch(f"/vehicles/{vehicle['vehicle_id']}", json={"nickname": "Nova"})
    assert changed.status_code == 200
    assert changed.json()["nickname"] == "Nova"
    second = client_for(path)
    saved = second.get(f"/vehicles/{vehicle['vehicle_id']}").json()
    assert saved["nickname"] == "Nova"


def test_vehicle_image_generated_from_identity_and_color(tmp_path):
    class FakeImageGenerator:
        def __init__(self):
            self.calls = []

        async def generate(self, vehicle):
            self.calls.append((vehicle.year, vehicle.make, vehicle.model, vehicle.exterior_color))
            return "data:image/webp;base64,UklGRg=="

    generator = FakeImageGenerator()
    path = tmp_path / "vehicle-image.sqlite"
    client = TestClient(create_app(Settings(db_path=str(path)), spark=HappyPathSpark(),
                                   environment_provider=NoWeather(), image_generator=generator))
    response = client.post("/vehicles", json={
        "spec_id": "demo", "year": 2021, "make": "Honda", "model": "Civic",
        "exterior_color": "Lunar Silver Metallic", "odometer_km": 80000,
    })
    assert response.status_code == 200
    vid = response.json()["vehicle_id"]
    saved = client.get(f"/vehicles/{vid}").json()
    assert saved["image_status"] == "ready"
    assert saved["generated_image_data_url"].startswith("data:image/webp;base64,")
    assert generator.calls == [(2021, "Honda", "Civic", "Lunar Silver Metallic")]
    assert client_for(path).get(f"/vehicles/{vid}").json()["image_status"] == "ready"
    client.patch(f"/vehicles/{vid}", json={"nickname": "Sunny"})
    assert len(generator.calls) == 1
    client.patch(f"/vehicles/{vid}", json={"exterior_color": "Rallye Red"})
    assert generator.calls[-1] == (2021, "Honda", "Civic", "Rallye Red")
    assert len(generator.calls) == 2


def test_same_rule_responds_to_driving_profile_and_history(tmp_path):
    client = client_for(tmp_path / "care.sqlite")
    low = create_vehicle(client, 55)
    high = create_vehicle(client, 300)
    now = datetime.now(timezone.utc).isoformat()
    client.post("/maintenance-records", json={
        "vehicle_id": low["vehicle_id"], "component": "tires", "event_type": "inspection",
        "completed_at": now, "user_confirmed": True, "notes": "Pressure checked with a gauge",
    })
    low_care = recommendations(client, low["vehicle_id"])["recommendations"]
    high_care = recommendations(client, high["vehicle_id"])["recommendations"]
    low_tire = next(item for item in low_care if item["component"] == "tires")
    high_tire = next(item for item in high_care if item["component"] == "tires")
    assert low_tire["priority"] == "ROUTINE"
    assert high_tire["priority"] == "CHECK_SOON"
    assert "replacement prediction" in high_tire["explanation"]
    assert any(e["value"] == "300 mi/week" for e in high_tire["evidence"])
    assert high_tire["manufacturer_guidance_status"] == "unavailable"


def test_missing_inputs_weather_and_unconfirmed_records(tmp_path):
    client = client_for(tmp_path / "missing.sqlite")
    vehicle = client.post("/vehicles", json={"spec_id": "demo", "year": 2021}).json()
    care = recommendations(client, vehicle["vehicle_id"])
    assert care["environment"]["status"] == "unavailable"
    assert all(item["priority"] == "INFORMATION_NEEDED" for item in care["recommendations"])
    refused = client.post("/maintenance-records", json={
        "vehicle_id": vehicle["vehicle_id"], "component": "washer_fluid",
        "event_type": "refill", "user_confirmed": False,
    })
    assert refused.status_code == 422
    omitted = client.post("/maintenance-records", json={
        "vehicle_id": vehicle["vehicle_id"], "component": "washer_fluid", "event_type": "refill",
    })
    assert omitted.status_code == 422
    assert client.get(f"/vehicles/{vehicle['vehicle_id']}/memory").json() == []


def test_real_weather_context_changes_only_contextual_inspection_priority():
    now = datetime.now(timezone.utc)
    vehicle = VehicleProfile(vehicle_id="v1", spec_id="demo", year=2021, region="Seattle", created_at=now)
    dry = calculate_recommendations(vehicle, [], now, EnvironmentContext(status="available", area="Seattle", rainfall_mm=0))
    wet = calculate_recommendations(vehicle, [], now, EnvironmentContext(status="available", area="Seattle", rainfall_mm=16))
    assert dry[0].component == "washer_fluid" and dry[0].priority == "INFORMATION_NEEDED"
    washer = next(item for item in wet if item.component == "washer_fluid")
    assert washer.priority == "CHECK_SOON"
    assert any(item.source == "external_weather" for item in washer.evidence)
    assert "actual fluid level is still unknown" in washer.explanation


def test_weather_provider_failure_stays_unavailable(monkeypatch):
    class FailedClient:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def get(self, *args, **kwargs): raise httpx.ConnectError("offline")

    monkeypatch.setattr("carmori.weather.httpx.AsyncClient", FailedClient)
    result = asyncio.run(OpenMeteoEnvironment().get("Seattle, WA"))
    assert result.status == "unavailable" and result.rainfall_mm is None


def test_camera_observed_refill_counts_as_completed_work():
    now = datetime.now(timezone.utc)
    vehicle = VehicleProfile(vehicle_id="v1", spec_id="demo", year=2021, created_at=now)
    observed = MaintenanceRecord(
        record_id="r1", vehicle_id="v1", completed_at=now,
        completion_source=CompletionSource.OBSERVED_SEQUENCE, user_confirmed=False,
    )
    washer = calculate_recommendations(vehicle, [observed], now)[-1]
    assert washer.component == "washer_fluid" and washer.priority == "ROUTINE"
    assert washer.evidence[-1].record_id == "r1"
    last_refill = next(f for f in build_facts(vehicle, DEMO_SPEC, [observed], None, now) if f.id == "last_refill")
    assert last_refill.text == "The last washer fluid refill was logged today, observed by camera."
    text, ids = render_memory_answer([observed], now)
    assert "observed by camera" in text and ids == ["r1"]
