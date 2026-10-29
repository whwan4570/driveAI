from __future__ import annotations

from datetime import datetime, timezone

from fastapi.testclient import TestClient

from carmori.briefing import build_facts
from carmori.care import calculate_recommendations
from carmori.config import Settings
from carmori.main import create_app
from carmori.models import VehicleProfile
from carmori.spark import HappyPathSpark
from carmori.vehicles import DEMO_SPEC, SONATA_2014_SPEC, match_spec
from carmori.weather import EnvironmentContext


class NoWeather:
    async def get(self, region: str | None, coords: tuple[float, float] | None = None) -> EnvironmentContext:
        return EnvironmentContext(area=region)


def client_for(path) -> TestClient:
    return TestClient(create_app(Settings(db_path=str(path)), spark=HappyPathSpark(), environment_provider=NoWeather()))


def test_match_spec_needs_year_make_and_model():
    assert match_spec(2014, "hyundai", " Sonata ") is SONATA_2014_SPEC
    assert match_spec(2013, "Hyundai", "Sonata") is None
    assert match_spec(2014, "Hyundai", "Sonata Hybrid") is None
    assert match_spec(2014, "Kia", "Optima") is None


def test_registering_a_2014_sonata_uses_its_manual_guide(tmp_path):
    client = client_for(tmp_path / "carmori.sqlite")
    vehicle = client.post("/vehicles", json={
        "spec_id": "demo", "year": 2014, "make": "Hyundai", "model": "Sonata", "exterior_color": "White",
    }).json()
    assert vehicle["spec_id"] == SONATA_2014_SPEC.spec_id

    washer = next(r for r in client.get(f"/vehicles/{vehicle['vehicle_id']}/care-recommendations").json()["recommendations"]
                  if r["component"] == "washer_fluid")
    assert washer["manufacturer_guidance_status"] == "owner_manual"
    assert {"label": "Owner's manual", "value": "Check washer fluid at each fuel stop (p. 7-5)",
            "source": "owner_manual", "record_id": None} in washer["evidence"]
    assert washer["unknown"] == ["Current fluid level"]

    briefing = client.post("/briefings", json={"vehicle_id": vehicle["vehicle_id"]}).json()
    assert "stop for fuel" in briefing["text"]
    assert {f["id"] for f in briefing["facts"]} >= {"manual_washer_location", "manual_no_coolant"}


def test_editing_away_from_the_sonata_drops_its_guide(tmp_path):
    client = client_for(tmp_path / "carmori.sqlite")
    vehicle_id = client.post("/vehicles", json={"spec_id": "demo", "year": 2014, "make": "Hyundai", "model": "Sonata"}).json()["vehicle_id"]
    edited = client.patch(f"/vehicles/{vehicle_id}", json={"year": 2015})
    assert edited.status_code == 200
    assert edited.json()["spec_id"] == DEMO_SPEC.spec_id
    assert client.patch(f"/vehicles/{vehicle_id}", json={"year": 2014}).json()["spec_id"] == SONATA_2014_SPEC.spec_id


def test_generic_guide_keeps_manual_unavailable():
    now = datetime(2026, 10, 28, tzinfo=timezone.utc)
    vehicle = VehicleProfile(vehicle_id="v1", spec_id="demo", year=2021, created_at=now)
    facts = {f.id for f in build_facts(vehicle, DEMO_SPEC, [], None, now)}
    assert "manufacturer_guidance" in facts and "manual_washer_check" not in facts
    washer = calculate_recommendations(vehicle, [], now)[0]
    assert washer.manufacturer_guidance_status == "unavailable"
