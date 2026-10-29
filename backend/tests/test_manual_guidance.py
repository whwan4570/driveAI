from datetime import datetime, timezone

from fastapi.testclient import TestClient

from carmori.config import Settings
from carmori.main import create_app
from carmori.manual_guidance import find_manual_guidance
from carmori.models import VehicleProfile
from carmori.spark import HappyPathSpark


def vehicle(model: str = "Civic", trim: str | None = None) -> VehicleProfile:
    return VehicleProfile(vehicle_id="test", spec_id="demo", year=2021, make="Honda", model=model,
                          trim=trim, created_at=datetime.now(timezone.utc))


def test_passenger_seat_answer_is_conditional_when_body_and_trim_are_unknown():
    result = find_manual_guidance(vehicle(), "How can I move to baward at passenger seat?")
    assert result is not None
    assert "For a 2021 Civic Sedan" in result.text
    assert "Confirm the body style and trim" in result.text
    assert result.source_url.startswith("https://techinfo.honda.com/")


def test_different_body_or_model_does_not_receive_sedan_guidance():
    assert find_manual_guidance(vehicle("Civic Hatchback"), "How do I move the passenger seat?") is None
    assert find_manual_guidance(vehicle("Accord"), "How do I move the passenger seat?") is None
    assert find_manual_guidance(vehicle(), "How do I fold the rear passenger seat?") is None


def test_assistant_returns_official_source_for_matching_vehicle_question():
    client = TestClient(create_app(Settings(), spark=HappyPathSpark()))
    created = client.post("/vehicles", json={"spec_id": "demo", "year": 2021, "make": "Honda", "model": "Civic"}).json()
    response = client.post("/assistant/ask", json={"vehicle_id": created["vehicle_id"],
                                                "question": "How do I move the passenger seat forward?"})
    assert response.status_code == 200
    answer = response.json()
    assert "owner_manual" in answer["fact_ids"]
    assert answer["source_label"] == "Honda 2021 Civic Sedan Owner’s Manual"
    assert answer["source_url"].endswith("ATBA2121OM.pdf")


def test_brake_pad_question_gives_action_without_inventing_replacement_mileage():
    client = TestClient(create_app(Settings(), spark=HappyPathSpark()))
    created = client.post("/vehicles", json={"spec_id": "demo", "year": 2021, "make": "Honda", "model": "Civic",
                                             "odometer_km": 77249, "weekly_miles": 210, "highway_percent": 35}).json()
    response = client.post("/assistant/ask", json={"vehicle_id": created["vehicle_id"],
                                                "question": "When should I change my break pads for my driving style?"})
    assert response.status_code == 200
    answer = response.json()
    assert "48,000 mi" in answer["text"]
    assert "210 mi/week" in answer["text"]
    assert "having the pads checked now" in answer["text"]
    assert "remaining pad thickness" in answer["text"]
    assert answer["source_url"].endswith("#page=520")


def test_2014_sonata_brake_answer_uses_inspection_schedule_not_replacement_mileage():
    client = TestClient(create_app(Settings(), spark=HappyPathSpark()))
    created = client.post("/vehicles", json={"spec_id": "demo", "year": 2014, "make": "Hyundai",
                                             "model": "Sonata", "odometer_km": 268760}).json()
    response = client.post("/assistant/ask", json={"vehicle_id": created["vehicle_id"],
                                                  "question": "When should I replace my brake pads?"})
    assert response.status_code == 200
    answer = response.json()
    assert "15,000 miles or 12 months" in answer["text"]
    assert "no fixed pad-replacement mileage" in answer["text"]
    assert answer["source_url"].endswith("2014-Hyundai-Sonata-OM.pdf")

    hybrid = vehicle("Sonata Hybrid")
    hybrid.year = 2014
    hybrid.make = "Hyundai"
    assert find_manual_guidance(hybrid, "When should I replace brake pads?") is None
