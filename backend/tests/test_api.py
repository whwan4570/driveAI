from __future__ import annotations

import base64
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from carmori.config import Settings
from carmori.main import create_app
from carmori.spark import HappyPathSpark

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
    assert "보충 기록이 없어요" in briefing["text"]
    assert "남은 워셔액 양은 확인한 적이 없어요" in briefing["text"]

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
    assert record["completion_source"] == "observed_sequence"

    again = client.post(f"/sessions/{sid}/observations", json=windows(seq)).json()
    assert again["windows"][0]["reason"] == "already_recorded"

    memory = client.get(f"/vehicles/{vid}/memory").json()
    assert len(memory) == 1

    answer = client.post("/assistant/ask", json={"vehicle_id": vid, "question": "아까 뭐 했지?"}).json()
    assert "워셔액 보충을 기록했어요" in answer["text"]
    assert answer["fact_ids"] == [memory[0]["record_id"]]


def test_unsupported_vehicle_is_rejected():
    client = make_client()
    assert client.post("/vehicles", json={"spec_id": "demo", "year": 1990}).status_code == 422
    assert client.post("/vehicles", json={"spec_id": "nope", "year": 2021}).status_code == 422


def test_voice_restart_resets_session():
    client = make_client()
    vid = client.post("/vehicles", json={"spec_id": "demo", "year": 2021}).json()["vehicle_id"]
    sid = client.post("/sessions", json={"vehicle_id": vid}).json()["session"]["session_id"]
    client.post(f"/sessions/{sid}/observations", json=windows(1))
    body = client.post(f"/sessions/{sid}/voice", json={"intent": "RESTART"}).json()
    assert body["session"]["step"] == "FIND_INLET"
    assert body["session"]["attempt"] == 2
