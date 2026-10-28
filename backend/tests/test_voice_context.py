from fastapi.testclient import TestClient

from carmori.config import Settings
from carmori.main import create_app
from carmori.spark import HappyPathSpark


def test_work_questions_use_current_session_and_do_not_claim_unseen_product():
    client = TestClient(create_app(Settings(), spark=HappyPathSpark()))
    first = client.post("/vehicles", json={"spec_id": "demo", "year": 2021}).json()["vehicle_id"]
    other = client.post("/vehicles", json={"spec_id": "demo", "year": 2022}).json()["vehicle_id"]
    session_id = client.post("/sessions", json={"vehicle_id": first}).json()["session"]["session_id"]

    def ask(question: str, vehicle_id: str = first):
        return client.post("/assistant/ask", json={"vehicle_id": vehicle_id, "session_id": session_id, "question": question})

    assert "not confirmed" in ask("Is this bottle right?").json()["text"]
    assert "inlet" in ask("What should I do next?").json()["text"].lower()
    assert "not recorded" in ask("What did I just do?").json()["text"]
    paused = client.post(f"/sessions/{session_id}/voice", json={"intent": "PAUSE"})
    assert paused.json()["session"]["paused"] is True
    resumed = client.post(f"/sessions/{session_id}/voice", json={"intent": "RESUME"})
    assert resumed.json()["session"]["paused"] is False
    assert ask("Where are we?", other).status_code == 400
