from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from carmori.config import Settings
from carmori.main import create_app
from carmori.models import SceneAnswer, Step, Tri
from carmori.spark import HappyPathSpark
from carmori.vehicle_recognition import VehicleScanResult, clean_vin

JPEG = base64.b64encode(b"\xff\xd8fake\xff\xd9").decode()


def make_client() -> TestClient:
    return TestClient(create_app(Settings(), spark=HappyPathSpark()))


def windows(seq: int) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "windows": [
            {
                "sequence_id": seq + i,
                "frames": [
                    {"frame_id": f"w{seq + i}-{j}", "captured_at": now, "jpeg_base64": JPEG}
                    for j in range(2)
                ],
            }
            for i in range(2)
        ]
    }


def test_happy_path_records_once_and_updates_memory():
    client = make_client()
    vehicle = client.post("/vehicles", json={"spec_id": "demo", "year": 2021}).json()
    vid = vehicle["vehicle_id"]

    briefing = client.post("/briefings", json={"vehicle_id": vid}).json()
    assert "There is no washer fluid refill on record" in briefing["text"]
    assert "I have not checked the actual washer fluid level" in briefing["text"]

    started = client.post("/sessions", json={"vehicle_id": vid}).json()
    sid = started["session"]["session_id"]
    assert started["spoken_hint"]

    seq, steps, record = 1, [], None
    for _ in range(5):
        body = client.post(f"/sessions/{sid}/observations", json=windows(seq)).json()
        seq += 2
        steps.append(body["session"]["step"])
        record = body["record"] or record
    assert steps == ["OPEN_CAP", "CONFIRM_PRODUCT", "POUR", "FINISH", "RECORDED"]
    assert record is not None
    assert record["completion_source"] == "observed_sequence"
    assert record["user_confirmed"] is False

    again = client.post(f"/sessions/{sid}/observations", json=windows(seq)).json()
    assert again["windows"][0]["reason"] == "already_recorded"

    memory = client.get(f"/vehicles/{vid}/memory").json()
    assert len(memory) == 1

    after = client.post("/briefings", json={"vehicle_id": vid}).json()
    assert "logged today, observed by camera" in after["text"]

    answer = client.post("/assistant/ask", json={"vehicle_id": vid, "question": "What did I do earlier?"}).json()
    assert "A washer fluid refill was logged" in answer["text"]
    assert "observed by camera" in answer["text"]
    assert answer["fact_ids"] == [memory[0]["record_id"]]


class UnseenPourSpark(HappyPathSpark):
    _ANSWERS = {
        **HappyPathSpark._ANSWERS,
        Step.POUR: SceneAnswer(bottle_over_inlet=Tri.YES, bottle_tilted=Tri.YES, flow_visible=Tri.UNCLEAR),
    }


def test_touch_confirmation_records_manual_entry_and_counts_in_care():
    client = TestClient(create_app(Settings(), spark=UnseenPourSpark()))
    vid = client.post("/vehicles", json={"spec_id": "demo", "year": 2021}).json()["vehicle_id"]
    sid = client.post("/sessions", json={"vehicle_id": vid}).json()["session"]["session_id"]
    seq = 1
    for _ in range(5):
        body = client.post(f"/sessions/{sid}/observations", json=windows(seq)).json()
        seq += 2
    assert body["session"]["waiting_reason"] == "NEED_VOICE_CONFIRM"
    assert body["record"] is None
    confirmed = client.post(f"/sessions/{sid}/voice", json={"intent": "CONFIRM_YES", "via": "touch"}).json()
    assert confirmed["record"]["completion_source"] == "manual_entry"
    assert confirmed["record"]["user_confirmed"] is True
    care = client.get(f"/vehicles/{vid}/care-recommendations").json()
    washer = next(item for item in care["recommendations"] if item["component"] == "washer_fluid")
    assert washer["priority"] == "ROUTINE"


def test_slow_model_response_is_not_treated_as_stale(monkeypatch):
    import carmori.main as main_module

    clock = {"now": datetime.now(timezone.utc)}
    monkeypatch.setattr(main_module, "utcnow", lambda: clock["now"])

    class SlowSpark(HappyPathSpark):
        async def analyze(self, frames, step, reference=None):
            # 실측한 Meta 관찰 응답(약 9초)만큼 서버 시계를 앞당긴다.
            clock["now"] += timedelta(seconds=9.2)
            return await super().analyze(frames, step, reference)

    client = TestClient(create_app(Settings(), spark=SlowSpark()))
    vid = client.post("/vehicles", json={"spec_id": "demo", "year": 2021}).json()["vehicle_id"]
    sid = client.post("/sessions", json={"vehicle_id": vid}).json()["session"]["session_id"]
    captured = clock["now"].isoformat()
    body = client.post(f"/sessions/{sid}/observations", json={"windows": [
        {"sequence_id": i, "frames": [{"frame_id": f"s{i}", "captured_at": captured, "jpeg_base64": JPEG}]}
        for i in (1, 2)
    ]}).json()
    assert [w["reason"] for w in body["windows"]] != ["stale_frames", "stale_frames"]
    assert body["session"]["step"] == "OPEN_CAP"


def test_unsupported_vehicle_is_rejected():
    client = make_client()
    assert client.post("/vehicles", json={"spec_id": "demo", "year": 1970}).status_code == 422
    assert client.post("/vehicles", json={"spec_id": "nope", "year": 2021}).status_code == 422


def test_voice_restart_resets_session():
    client = make_client()
    vid = client.post("/vehicles", json={"spec_id": "demo", "year": 2021}).json()["vehicle_id"]
    sid = client.post("/sessions", json={"vehicle_id": vid}).json()["session"]["session_id"]
    client.post(f"/sessions/{sid}/observations", json=windows(1))
    body = client.post(f"/sessions/{sid}/voice", json={"intent": "RESTART"}).json()
    assert body["session"]["step"] == "FIND_INLET"
    assert body["session"]["attempt"] == 2


def test_assistant_recounts_latest_confirmed_tire_action():
    client = make_client()
    vid = client.post("/vehicles", json={"spec_id": "demo", "year": 2021}).json()["vehicle_id"]
    saved = client.post("/maintenance-records", json={
        "vehicle_id": vid, "component": "tires", "event_type": "inspection",
        "user_confirmed": True, "notes": "Pressure measured with a gauge",
    }).json()
    answer = client.post("/assistant/ask", json={"vehicle_id": vid, "question": "What did I do earlier?"}).json()
    assert "tire inspection" in answer["text"]
    assert "Pressure measured with a gauge" in answer["text"]
    assert answer["fact_ids"] == [saved["record_id"]]


def test_service_replacements_are_saved_and_recounted():
    client = make_client()
    vid = client.post("/vehicles", json={"spec_id": "demo", "year": 2021}).json()["vehicle_id"]
    for component in ("engine_oil", "brake_pads", "cabin_filter", "engine_air_filter"):
        saved = client.post("/maintenance-records", json={
            "vehicle_id": vid, "component": component, "event_type": "replacement",
            "user_confirmed": True, "odometer_km": 80000,
        })
        assert saved.status_code == 200
        assert saved.json()["component"] == component
        invalid = client.post("/maintenance-records", json={
            "vehicle_id": vid, "component": component, "event_type": "refill",
            "user_confirmed": True,
        })
        assert invalid.status_code == 422
    memory = client.get(f"/vehicles/{vid}/memory").json()
    assert len(memory) == 4
    answer = client.post("/assistant/ask", json={"vehicle_id": vid, "question": "What did I do earlier?"}).json()
    assert "engine air filter replacement" in answer["text"]


def test_vehicle_scan_requires_real_model_and_rejects_bad_images():
    client = make_client()
    image = base64.b64encode(b"\xff\xd8" + b"x" * 150 + b"\xff\xd9").decode()
    assert client.get("/vehicles/recognition-status").json() == {"available": False}
    result = client.post("/vehicles/recognize", json={"mode": "vin", "jpeg_base64": image})
    assert result.status_code == 200
    assert result.json()["status"] == "unavailable"
    assert client.post("/vehicles/recognize", json={"mode": "vin", "jpeg_base64": "bad" * 40}).status_code == 422


def test_scanned_vehicle_is_confirmed_and_used_in_briefing():
    class Recognizer:
        async def recognize(self, jpeg: bytes, mode: str) -> VehicleScanResult:
            assert jpeg.startswith(b"\xff\xd8")
            assert mode == "vin"
            return VehicleScanResult(
                status="recognized", source="vin", make="Honda", model="Civic",
                year=2021, vin_last4="1234", message="VIN decoded.",
            )

    client = TestClient(create_app(Settings(), spark=HappyPathSpark(), recognizer=Recognizer()))
    image = base64.b64encode(b"\xff\xd8" + b"x" * 150 + b"\xff\xd9").decode()
    result = client.post("/vehicles/recognize", json={"mode": "vin", "jpeg_base64": image}).json()
    assert result["make"] == "Honda" and result["vin_last4"] == "1234"
    assert "vin" not in result
    vehicle = client.post("/vehicles", json={"spec_id": "demo", "year": result["year"], "make": result["make"], "model": result["model"]}).json()
    assert client.get(f"/vehicles/{vehicle['vehicle_id']}").json()["model"] == "Civic"
    facts = client.post("/briefings", json={"vehicle_id": vehicle["vehicle_id"]}).json()["facts"]
    assert any(f["text"] == "2021 Honda Civic" for f in facts)


def test_vin_requires_all_seventeen_unambiguous_characters():
    assert clean_vin("1HGCM82633A004352") == "1HGCM82633A004352"
    assert clean_vin("1HGCM82633A00435O") is None
    assert clean_vin("1HGCM82633A00435") is None


def test_purchase_document_scan_can_prefill_vehicle_without_creating_refill_history():
    class Recognizer:
        async def recognize_document(self, data: bytes, mime: str, document_type: str) -> VehicleScanResult:
            assert data.startswith(b"%PDF-")
            assert mime == "application/pdf"
            assert document_type == "window_sticker"
            return VehicleScanResult(
                status="recognized", source="document", document_type="window_sticker",
                make="Toyota", model="Corolla", year=2022,
                message="Vehicle details were read from the document.",
            )

    client = TestClient(create_app(Settings(), spark=HappyPathSpark(), recognizer=Recognizer()))
    file_data = base64.b64encode(b"%PDF-1.7\n" + b"x" * 150).decode()
    scanned = client.post("/vehicles/recognize-document", json={
        "document_type": "window_sticker", "mime_type": "application/pdf", "data_base64": file_data,
    })
    assert scanned.status_code == 200
    result = scanned.json()
    assert (result["make"], result["model"], result["year"]) == ("Toyota", "Corolla", 2022)
    assert client.post("/vehicles/recognize-document", json={
        "document_type": "window_sticker", "mime_type": "application/pdf", "data_base64": base64.b64encode(b"not a pdf" * 20).decode(),
    }).status_code == 422
    vehicle = client.post("/vehicles", json={"spec_id": "demo", "year": 2022, "make": "Toyota", "model": "Corolla"}).json()
    assert client.get(f"/vehicles/{vehicle['vehicle_id']}/memory").json() == []
