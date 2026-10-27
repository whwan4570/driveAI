from __future__ import annotations

import asyncio
import base64
import json
from datetime import datetime, timezone
from io import BytesIO

import httpx
import pytest
from PIL import Image

from carmori.config import Settings
from carmori.models import VehicleProfile
from carmori.vehicle_image import MetaVehicleImageGenerator, VehicleImageError
from carmori.vehicle_cutout import compose_cutout


class FakeCutout:
    async def remove(self, data_url: str) -> str:
        return data_url


def sample_vehicle() -> VehicleProfile:
    return VehicleProfile(vehicle_id="sample", spec_id="demo", year=2021, make="Honda",
                          model="Civic", exterior_color="Lunar Silver Metallic",
                          created_at=datetime.now(timezone.utc))


def test_meta_image_generation_uses_confirmed_car_and_color(monkeypatch):
    real_client = httpx.AsyncClient
    webp = b"RIFF\x04\x00\x00\x00WEBPdata"

    def handle(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/images/generations"
        body = json.loads(request.content)
        assert body["model"] == "muse-image-1.0"
        assert "2021 Honda Civic" in body["prompt"]
        assert "Lunar Silver Metallic" in body["prompt"]
        assert "No eyes, mouth" in body["prompt"]
        return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(webp).decode()}]})

    monkeypatch.setattr(httpx, "AsyncClient", lambda *a, **kw: real_client(*a, transport=httpx.MockTransport(handle), **kw))
    result = asyncio.run(MetaVehicleImageGenerator(Settings(meta_api_key="test-key"), FakeCutout()).generate(sample_vehicle()))
    assert result == "data:image/webp;base64," + base64.b64encode(webp).decode()


def test_meta_image_billing_failure_is_actionable(monkeypatch):
    real_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda *a, **kw: real_client(
        *a, transport=httpx.MockTransport(lambda request: httpx.Response(402, request=request)), **kw))
    with pytest.raises(VehicleImageError, match="billing"):
        asyncio.run(MetaVehicleImageGenerator(Settings(meta_api_key="test-key"), FakeCutout()).generate(sample_vehicle()))


def test_sam_mask_makes_background_transparent():
    source = BytesIO()
    Image.new("RGB", (30, 30), "navy").save(source, format="WEBP")
    cutout = compose_cutout(source.getvalue(), bytes([1] * 25), (5, 5), (10, 10, 19, 19))
    image = Image.open(BytesIO(cutout)).convert("RGBA")
    assert image.getpixel((0, 0))[3] == 0
    assert image.getpixel((14, 14))[3] == 255
