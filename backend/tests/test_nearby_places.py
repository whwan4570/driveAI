import asyncio

import httpx
from fastapi.testclient import TestClient

from carmori.config import Settings
from carmori.main import create_app
from carmori.nearby_places import nearby_vehicle_places
from carmori.spark import HappyPathSpark


def test_nearby_endpoint_validates_coordinates():
    client = TestClient(create_app(Settings(), spark=HappyPathSpark()))
    assert client.get("/places/nearby", params={"lat": 100, "lon": 0}).status_code == 422


def test_nearby_places_classifies_map_tags(monkeypatch):
    class FakeClient:
        def __init__(self, **_kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *_args): pass
        async def post(self, _url, data, headers):
            assert '"amenity"="fuel"' in data["data"]
            assert '"shop"="car_repair"' in data["data"]
            assert '"amenity"="car_wash"' in data["data"]
            assert headers["User-Agent"]
            return httpx.Response(200, json={"elements": [
                {"type": "node", "id": 1, "lat": 34.0, "lon": -118.0, "tags": {"amenity": "fuel", "name": "Fuel A"}},
                {"type": "way", "id": 2, "center": {"lat": 34.0002, "lon": -118.0}, "tags": {"shop": "car_repair"}},
                {"type": "node", "id": 3, "lat": 34.0003, "lon": -118.0, "tags": {"amenity": "car_wash"}},
            ]}, request=httpx.Request("POST", "https://overpass-api.de/api/interpreter"))

    monkeypatch.setattr("carmori.nearby_places.httpx.AsyncClient", FakeClient)
    places = asyncio.run(nearby_vehicle_places(34.0, -118.0))
    assert [place["category"] for place in places] == ["fuel", "repair", "wash"]
    assert places[0]["name"] == "Fuel A"
