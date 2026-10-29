from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from carmori.config import Settings
from carmori.main import create_app
from carmori.spark import HappyPathSpark
from carmori.store import SQLiteStore


def test_relationship_dates_and_major_issue_history(tmp_path):
    store = SQLiteStore(str(tmp_path / "carmori.sqlite"))
    client = TestClient(create_app(Settings(), spark=HappyPathSpark(), store=store))
    vehicle = client.post("/vehicles", json={
        "spec_id": "demo", "year": 2021,
        "purchased_on": "2024-03-10", "first_drive_on": "2024-03-12",
        "major_issue_free_confirmed": True,
    }).json()
    vehicle_id = vehicle["vehicle_id"]
    assert vehicle["purchased_on"] == "2024-03-10"
    assert vehicle["major_issue_free_confirmed"] is True
    assert client.get(f"/vehicles/{vehicle_id}/major-issues").json() == []

    issue = client.post(f"/vehicles/{vehicle_id}/major-issues", json={
        "kind": "accident", "occurred_on": "2025-01-02", "notes": "Minor collision",
    })
    assert issue.status_code == 201
    issue_id = issue.json()["issue_id"]
    assert client.get(f"/vehicles/{vehicle_id}").json()["major_issue_free_confirmed"] is False
    assert client.get(f"/vehicles/{vehicle_id}/major-issues").json()[0]["kind"] == "accident"
    assert client.patch(f"/vehicles/{vehicle_id}", json={"major_issue_free_confirmed": True}).status_code == 422

    reopened = TestClient(create_app(Settings(), spark=HappyPathSpark(), store=SQLiteStore(str(tmp_path / "carmori.sqlite"))))
    assert reopened.get(f"/vehicles/{vehicle_id}").json()["first_drive_on"] == "2024-03-12"
    assert reopened.get(f"/vehicles/{vehicle_id}/major-issues").json()[0]["issue_id"] == issue_id
    assert reopened.delete(f"/vehicles/{vehicle_id}/major-issues/{issue_id}").status_code == 204
    assert reopened.get(f"/vehicles/{vehicle_id}/major-issues").json() == []
    assert reopened.patch(f"/vehicles/{vehicle_id}", json={"major_issue_free_confirmed": True}).status_code == 200


def test_relationship_rejects_unsupported_dates():
    client = TestClient(create_app(Settings(), spark=HappyPathSpark()))
    assert client.post("/vehicles", json={
        "spec_id": "demo", "year": 2021,
        "purchased_on": "2024-03-10", "first_drive_on": "2024-03-09",
    }).status_code == 422
    assert client.post("/vehicles", json={
        "spec_id": "demo", "year": 2021, "major_issue_free_confirmed": True,
    }).status_code == 422
    vehicle_id = client.post("/vehicles", json={"spec_id": "demo", "year": 2021}).json()["vehicle_id"]
    tomorrow = (datetime.now(timezone.utc).date() + timedelta(days=1)).isoformat()
    assert client.post(f"/vehicles/{vehicle_id}/major-issues", json={
        "kind": "engine", "occurred_on": tomorrow,
    }).status_code == 422
    assert client.post(f"/vehicles/{vehicle_id}/major-issues", json={
        "kind": "routine_maintenance", "occurred_on": "2024-01-01",
    }).status_code == 422
