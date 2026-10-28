from __future__ import annotations

import json
from fastapi.testclient import TestClient

from carmori.config import Settings
from carmori.main import create_app
from carmori.spark import HappyPathSpark


def glb() -> bytes:
    content = json.dumps({"asset": {"version": "2.0"}, "meshes": [{"primitives": [{}]}]}).encode()
    content += b" " * (-len(content) % 4)
    length = 20 + len(content)
    return b"glTF" + (2).to_bytes(4, "little") + length.to_bytes(4, "little") + len(content).to_bytes(4, "little") + b"JSON" + content


def test_vehicle_3d_model_publish_and_identity_reset(tmp_path):
    client = TestClient(create_app(Settings(db_path=str(tmp_path / "cars.sqlite")), spark=HappyPathSpark()))
    vehicle = client.post("/vehicles", json={"spec_id": "demo", "year": 2021}).json()
    vehicle_id = vehicle["vehicle_id"]
    assert client.get(f"/vehicles/{vehicle_id}/3d-model").status_code == 404

    invalid = client.put(f"/vehicles/{vehicle_id}/3d-model", content=b"not a GLB")
    assert invalid.status_code == 422
    assert client.get(f"/vehicles/{vehicle_id}").json()["model_3d_status"] == "unavailable"

    published = client.put(f"/vehicles/{vehicle_id}/3d-model", content=glb())
    assert published.status_code == 200
    assert published.json()["model_3d_status"] == "ready"
    assert client.get(f"/vehicles/{vehicle_id}/3d-model").content == glb()

    changed = client.patch(f"/vehicles/{vehicle_id}", json={"year": 2022})
    assert changed.status_code == 200
    assert changed.json()["model_3d_status"] == "unavailable"
    assert client.get(f"/vehicles/{vehicle_id}/3d-model").status_code == 404
