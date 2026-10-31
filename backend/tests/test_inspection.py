from __future__ import annotations

import base64

from fastapi.testclient import TestClient

from carmori.config import Settings
from carmori.inspection import InspectionResult, MetaInspector
from carmori.main import create_app
from carmori.spark import HappyPathSpark


class FixedInspector:
    async def analyze(self, jpeg: bytes, component: str, photo_type: str) -> InspectionResult:
        assert jpeg.startswith(b"\xff\xd8")
        return InspectionResult(status="uncertain", component="washer_fluid", observation="No reliable cap location")


def test_photo_analysis_returns_uncertainty_and_validates_input():
    client = TestClient(create_app(Settings(), spark=HappyPathSpark(), inspector=FixedInspector()))
    vehicle = client.post("/vehicles", json={"spec_id": "demo", "year": 2021}).json()
    path = f"/vehicles/{vehicle['vehicle_id']}/inspections/analyze"
    jpeg = base64.b64encode(b"\xff\xd8" + b"x" * 100 + b"\xff\xd9").decode()
    result = client.post(path, json={"component": "washer_fluid", "photo_type": "engine", "jpeg_base64": jpeg})
    assert result.status_code == 200
    assert result.json()["status"] == "uncertain"
    assert result.json()["box"] is None
    assert client.post(path, json={"component": "tires", "photo_type": "engine", "jpeg_base64": jpeg}).status_code == 422
    assert client.post(path, json={"component": "washer_fluid", "photo_type": "engine", "jpeg_base64": "?" * 120}).status_code == 422


def test_model_box_must_be_high_confidence_and_in_range():
    class Spark:
        async def _vision_request(self, prompt: str, images: list[bytes]) -> str:
            return '{"located":true,"confidence":"medium","box":[0.1,0.1,0.5,0.5]}'

    result = __import__("asyncio").run(MetaInspector(Spark()).analyze(b"image", "washer_fluid", "engine"))
    assert result.status == "uncertain"
    assert result.box is None


def test_washer_cap_can_be_located_by_cap_and_narrow_neck_when_symbol_is_hidden():
    class Spark:
        async def _vision_request(self, prompt: str, images: list[bytes]) -> str:
            assert "lower left and right corners" in prompt
            assert "Blue color alone is not enough" in prompt
            return '{"located":true,"confidence":"high","basis":"cap_and_neck","box":[0.12,0.61,0.21,0.75]}'

    result = __import__("asyncio").run(MetaInspector(Spark()).analyze(b"image", "washer_fluid", "engine"))
    assert result.status == "located"
    assert result.box == [0.12, 0.61, 0.21, 0.75]
    assert "Check the cap" in result.observation


def test_blue_color_or_unexplained_box_alone_cannot_locate_inlet():
    class Spark:
        async def _vision_request(self, prompt: str, images: list[bytes]) -> str:
            return '{"located":true,"confidence":"high","box":[0.12,0.61,0.21,0.75]}'

    result = __import__("asyncio").run(MetaInspector(Spark()).analyze(b"image", "washer_fluid", "engine"))
    assert result.status == "uncertain"
    assert result.box is None


def test_product_photo_requires_readable_washer_label():
    class Spark:
        async def _vision_request(self, prompt: str, images: list[bytes]) -> str:
            return '{"label":null,"class":"washer_fluid","confidence":"high"}'

    result = __import__("asyncio").run(MetaInspector(Spark()).analyze(b"image", "washer_fluid", "product"))
    assert result.product_status == "UNKNOWN"


def test_inlet_search_logs_the_raw_model_reply(monkeypatch):
    class Spark:
        async def _vision_request(self, prompt: str, images: list[bytes]) -> str:
            return '{"located":false,"confidence":"low","basis":"uncertain","box":null,"observation":"blurry bay"}'

    logged: list[tuple] = []
    monkeypatch.setattr("carmori.inspection.log.info", lambda *args: logged.append(args))
    __import__("asyncio").run(MetaInspector(Spark()).analyze(b"image", "washer_fluid", "engine"))
    assert logged[0][1] == len(b"image")
    assert "blurry bay" in logged[0][2]


def test_clearly_different_item_is_reported_as_not_washer_fluid():
    class Spark:
        async def _vision_request(self, prompt: str, images: list[bytes]) -> str:
            assert "clearly not washer fluid" in prompt
            return '{"label":null,"class":"other","confidence":"high"}'

    result = __import__("asyncio").run(MetaInspector(Spark()).analyze(b"image", "washer_fluid", "product"))
    assert result.product_status == "CONFLICT"
    assert result.observation == "This isn't washer fluid. Don't pour it."

