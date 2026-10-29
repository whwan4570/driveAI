from pathlib import Path

import httpx
from fastapi.testclient import TestClient

from carmori.config import Settings
from carmori.main import create_app
from carmori.manual_cache import ManualCache
from carmori.manual_catalog import SONATA_2014
from carmori.spark import HappyPathSpark


PDF = b"%PDF-1.7\nsmall test PDF"


def test_registration_fetches_matching_manual_and_serves_local_copy(tmp_path: Path):
    requested = []

    def respond(request: httpx.Request) -> httpx.Response:
        requested.append(str(request.url))
        return httpx.Response(200, content=PDF)

    cache = ManualCache(tmp_path / "manuals", httpx.AsyncClient(transport=httpx.MockTransport(respond)))
    client = TestClient(create_app(Settings(auto_fetch_manuals=True), spark=HappyPathSpark(), manual_cache=cache))
    vehicle = client.post("/vehicles", json={"spec_id": "demo", "year": 2014, "make": "Hyundai",
                                             "model": "Sonata", "body_style": "sedan"}).json()
    vehicle_id = vehicle["vehicle_id"]
    status = client.get(f"/vehicles/{vehicle_id}/owner-manual/status").json()
    assert status["status"] == "ready"
    assert status["manual_url"].endswith(f"/{vehicle_id}/owner-manual")
    assert client.get(status["manual_url"]).content == PDF
    assert requested == [SONATA_2014.source_url]


def test_demo_sonata_uses_prefetched_pdf_without_a_network_request(tmp_path: Path):
    folder = tmp_path / "manuals"
    folder.mkdir()
    (folder / SONATA_2014.filename).write_bytes(PDF)

    def no_network(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"unexpected download: {request.url}")

    cache = ManualCache(folder, httpx.AsyncClient(transport=httpx.MockTransport(no_network)))
    client = TestClient(create_app(Settings(auto_fetch_manuals=True), spark=HappyPathSpark(), manual_cache=cache))
    vehicle = client.post("/vehicles", json={"spec_id": "demo", "year": 2014, "make": "Hyundai",
                                             "model": "Sonata", "profile_source": "demo"}).json()
    assert client.get(f"/vehicles/{vehicle['vehicle_id']}/owner-manual/status").json()["status"] == "ready"


def test_hybrid_does_not_receive_nonhybrid_manual(tmp_path: Path):
    cache = ManualCache(tmp_path / "manuals")
    client = TestClient(create_app(Settings(auto_fetch_manuals=True), spark=HappyPathSpark(), manual_cache=cache))
    vehicle = client.post("/vehicles", json={"spec_id": "demo", "year": 2014, "make": "Hyundai",
                                             "model": "Sonata Hybrid"}).json()
    vehicle_id = vehicle["vehicle_id"]
    assert client.get(f"/vehicles/{vehicle_id}/owner-manual/status").json()["status"] == "unsupported"
    assert client.get(f"/vehicles/{vehicle_id}/owner-manual").status_code == 404


def test_corrected_vehicle_profile_fetches_new_matching_manual(tmp_path: Path):
    requested = []

    def respond(request: httpx.Request) -> httpx.Response:
        requested.append(str(request.url))
        return httpx.Response(200, content=PDF)

    cache = ManualCache(tmp_path / "manuals", httpx.AsyncClient(transport=httpx.MockTransport(respond)))
    client = TestClient(create_app(Settings(auto_fetch_manuals=True), spark=HappyPathSpark(), manual_cache=cache))
    vehicle = client.post("/vehicles", json={"spec_id": "demo", "year": 2014, "make": "Hyundai",
                                             "model": "Santa Fe"}).json()
    vehicle_id = vehicle["vehicle_id"]
    assert client.get(f"/vehicles/{vehicle_id}/owner-manual/status").json()["status"] == "unsupported"
    client.patch(f"/vehicles/{vehicle_id}", json={"model": "Sonata"})
    assert client.get(f"/vehicles/{vehicle_id}/owner-manual/status").json()["status"] == "ready"
    assert requested == [SONATA_2014.source_url]


def test_invalid_download_is_not_cached_and_can_be_retried(tmp_path: Path):
    calls = 0

    def respond(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, content=b"<html>not a PDF</html>" if calls == 1 else PDF)

    cache = ManualCache(tmp_path / "manuals", httpx.AsyncClient(transport=httpx.MockTransport(respond)))
    client = TestClient(create_app(Settings(auto_fetch_manuals=True), spark=HappyPathSpark(), manual_cache=cache))
    vehicle = client.post("/vehicles", json={"spec_id": "demo", "year": 2014, "make": "Hyundai",
                                             "model": "Sonata"}).json()
    vehicle_id = vehicle["vehicle_id"]
    assert client.get(f"/vehicles/{vehicle_id}/owner-manual/status").json()["status"] == "failed"
    assert not cache.path(SONATA_2014).exists()
    client.post(f"/vehicles/{vehicle_id}/owner-manual/retry")
    assert client.get(f"/vehicles/{vehicle_id}/owner-manual/status").json()["status"] == "ready"
