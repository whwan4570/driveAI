from __future__ import annotations

import asyncio

import httpx
from fastapi.testclient import TestClient

from carmori.config import Settings
from carmori.main import create_app
from carmori.spark import HappyPathSpark
from carmori.vehicle_catalog import NhtsaModelCatalog


class FakeCatalog:
    def __init__(self) -> None:
        self.calls: list[tuple[str, int | None]] = []

    async def models(self, make: str, year: int | None) -> list[str]:
        self.calls.append((make, year))
        if make == "Offline":
            raise httpx.ConnectError("offline")
        return ["Accord", "Civic"]


def client_with(catalog) -> TestClient:
    return TestClient(create_app(Settings(), spark=HappyPathSpark(), model_catalog=catalog))


def test_makes_list_includes_popular_brands():
    body = client_with(FakeCatalog()).get("/vehicle-catalog/makes").json()
    assert "Honda" in body["makes"] and "Mercedes-Benz" in body["makes"]
    assert set(body["popular"]) <= set(body["makes"])


def test_models_pass_make_and_year_through():
    catalog = FakeCatalog()
    body = client_with(catalog).get("/vehicle-catalog/models", params={"make": "Honda", "year": 2021}).json()
    assert body == {"make": "Honda", "year": 2021, "models": ["Accord", "Civic"], "status": "available"}
    assert catalog.calls == [("Honda", 2021)]


def test_models_failure_is_reported_not_raised():
    body = client_with(FakeCatalog()).get("/vehicle-catalog/models", params={"make": "Offline"}).json()
    assert body["status"] == "unavailable" and body["models"] == []


def test_models_reject_path_like_make_names():
    client = client_with(FakeCatalog())
    assert client.get("/vehicle-catalog/models", params={"make": "../honda"}).status_code == 422
    assert client.get("/vehicle-catalog/models", params={"make": "Honda", "year": 1900}).status_code == 422


def test_nhtsa_catalog_merges_vehicle_types_and_caches(monkeypatch):
    requested: list[str] = []
    rows = {
        "car": [{"Model_Name": "Civic"}, {"Model_Name": "Accord"}],
        "mpv": [{"Model_Name": "CR-V"}, {"Model_Name": "civic"}],
        "truck": [{"Model_Name": "Ridgeline"}],
    }

    class FakeClient:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass

        async def get(self, url, params=None):
            requested.append(url)
            kind = url.rsplit("/", 1)[-1]
            return httpx.Response(200, json={"Results": rows[kind]}, request=httpx.Request("GET", url))

    monkeypatch.setattr("carmori.vehicle_catalog.httpx.AsyncClient", FakeClient)
    catalog = NhtsaModelCatalog()
    models = asyncio.run(catalog.models("Honda", 2021))
    assert models == ["Accord", "Civic", "CR-V", "Ridgeline"]
    assert all("/make/Honda/modelyear/2021/vehicletype/" in url for url in requested)
    asyncio.run(catalog.models("honda", 2021))
    assert len(requested) == 3
