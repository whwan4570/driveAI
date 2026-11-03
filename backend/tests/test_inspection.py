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


def test_tire_scan_api_accepts_each_view_and_rejects_mixed_components():
    class TireInspector:
        async def analyze(self, jpeg: bytes, component: str, photo_type: str) -> InspectionResult:
            assert component == "tires"
            assert photo_type in {"tire_sidewall", "tire_tread", "tire_tread_gauge"}
            return InspectionResult(status="located", component="tires", observation="Clear view", source="meta_vision", tire_view_valid=True)

    client = TestClient(create_app(Settings(), spark=HappyPathSpark(), inspector=TireInspector()))
    vehicle = client.post("/vehicles", json={"spec_id": "demo", "year": 2021}).json()
    path = f"/vehicles/{vehicle['vehicle_id']}/inspections/analyze"
    jpeg = base64.b64encode(b"\xff\xd8" + b"x" * 100 + b"\xff\xd9").decode()
    for photo_type in ("tire_sidewall", "tire_tread", "tire_tread_gauge"):
        result = client.post(path, json={"component": "tires", "photo_type": photo_type, "jpeg_base64": jpeg})
        assert result.status_code == 200
        assert result.json()["tire_view_valid"] is True
    assert client.post(path, json={"component": "washer_fluid", "photo_type": "tire_tread", "jpeg_base64": jpeg}).status_code == 422


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


def test_black_camera_reply_gives_a_specific_retry_hint():
    class Spark:
        async def _vision_request(self, prompt: str, images: list[bytes]) -> str:
            return '{"located":false,"confidence":"low","basis":"uncertain","box":null,"observation":"Frame is black; no engine bay visible"}'

    result = __import__("asyncio").run(MetaInspector(Spark()).analyze(b"image", "washer_fluid", "engine"))
    assert result.status == "uncertain"
    assert "too dark" in result.observation


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


def test_tire_view_must_be_clear_before_automatic_progress():
    class Spark:
        async def _vision_request(self, prompt: str, images: list[bytes]) -> str:
            assert "sidewall" in prompt
            return '{"view_valid":true,"confidence":"medium","findings":["bulge"],"observation":"possible bulge"}'

    result = __import__("asyncio").run(MetaInspector(Spark()).analyze(b"image", "tires", "tire_sidewall"))
    assert result.status == "uncertain"
    assert result.tire_view_valid is False
    assert result.tire_findings == []


def test_tire_sidewall_and_tread_keep_only_visible_findings_for_that_view():
    class Spark:
        async def _vision_request(self, prompt: str, images: list[bytes]) -> str:
            return '{"view_valid":true,"confidence":"high","view_quality":"good","tire_box":[0.1,0.1,0.9,0.8],"findings":["bulge","uneven_wear"],"observation":"visible"}'

    inspector = MetaInspector(Spark())
    sidewall = __import__("asyncio").run(inspector.analyze(b"image", "tires", "tire_sidewall"))
    tread = __import__("asyncio").run(inspector.analyze(b"image", "tires", "tire_tread"))
    assert sidewall.status == "located" and sidewall.tire_findings == ["bulge"]
    assert tread.status == "located" and tread.tire_findings == ["uneven_wear"]
    assert "pressure" in sidewall.observation.lower() or "professional" in sidewall.observation.lower()


def test_tread_gauge_requires_clear_scale_and_unit():
    class Spark:
        def __init__(self, reply: str): self.reply = reply
        async def _vision_request(self, prompt: str, images: list[bytes]) -> str:
            assert "physical tire tread-depth gauge" in prompt
            return self.reply

    valid = __import__("asyncio").run(MetaInspector(Spark('{"gauge_visible":true,"reading":7,"unit":"32nds_inch","confidence":"high"}')).analyze(b"image", "tires", "tire_tread_gauge"))
    assert valid.status == "located" and valid.gauge_value == 7 and valid.gauge_unit == "32nds_inch"
    for reply in (
        '{"gauge_visible":true,"reading":7,"unit":"unknown","confidence":"high"}',
        '{"gauge_visible":true,"reading":7,"unit":"mm","confidence":"medium"}',
        '{"gauge_visible":false,"reading":7,"unit":"mm","confidence":"high"}',
        '{"gauge_visible":true,"reading":true,"unit":"mm","confidence":"high"}',
    ):
        result = __import__("asyncio").run(MetaInspector(Spark(reply)).analyze(b"image", "tires", "tire_tread_gauge"))
        assert result.status == "uncertain" and result.gauge_value is None


def tire_reply(reply: str, photo_type: str = "tire_sidewall"):
    class Spark:
        async def _vision_request(self, prompt: str, images: list[bytes]) -> str:
            assert "view_quality" in prompt and "tire_box" in prompt
            return reply

    return __import__("asyncio").run(MetaInspector(Spark()).analyze(b"image", "tires", photo_type))


def test_good_tire_view_returns_the_box_for_the_camera_outline():
    result = tire_reply('{"view_valid":true,"confidence":"high","view_quality":"good","tire_box":[0.2,0.2,0.8,0.7],"findings":[]}')
    assert result.status == "located" and result.tire_view_valid is True
    assert result.tire_box == [0.2, 0.2, 0.8, 0.7]
    assert result.view_quality == "good" and result.rejection_reason is None


def test_small_tire_box_is_rejected_even_if_the_model_calls_it_good():
    result = tire_reply('{"view_valid":true,"confidence":"high","view_quality":"good","tire_box":[0.4,0.4,0.6,0.6],"findings":["bulge"]}')
    assert result.status == "uncertain" and result.rejection_reason == "too_small"
    assert result.tire_findings == []
    assert result.observation == "Move closer so the tire fills the view."
    assert result.tire_box == [0.4, 0.4, 0.6, 0.6]


def test_tire_rejections_say_why():
    cases = {
        "blurry": "blurry", "dark": "too dark", "no_tire": "don't see a real tire",
    }
    for quality, text in cases.items():
        result = tire_reply(f'{{"view_valid":false,"confidence":"high","view_quality":"{quality}","tire_box":null,"findings":[]}}')
        assert result.rejection_reason == quality and text in result.observation
    tread = tire_reply('{"view_valid":false,"confidence":"high","view_quality":"wrong_view","tire_box":[0.1,0.1,0.9,0.9],"findings":[]}', "tire_tread")
    assert tread.rejection_reason == "wrong_view" and "isn't the tread" in tread.observation


def test_tire_view_needs_quality_and_an_unusable_box_only_loses_the_outline():
    missing = tire_reply('{"view_valid":true,"confidence":"high","tire_box":[0.1,0.1,0.9,0.9],"findings":[]}')
    assert missing.status == "uncertain" and missing.rejection_reason == "unclear"
    pixels = tire_reply('{"view_valid":true,"confidence":"high","view_quality":"good","tire_box":[100,100,900,900],"findings":[]}')
    assert pixels.status == "located" and pixels.tire_box is None



def test_inlet_candidate_never_confirms_cap_and_rejects_invalid_box():
    class Spark:
        def __init__(self, reply: str):
            self.reply = reply

        async def _vision_request(self, prompt: str, images: list[bytes]) -> str:
            return self.reply

    import asyncio

    candidate = asyncio.run(MetaInspector(Spark('{"box":[0.1,0.2,0.3,0.4],"confidence":"high","reason":"candidate"}')).analyze(b"image", "washer_fluid", "engine_candidate"))
    assert candidate.status == "uncertain"
    assert candidate.box == [0.1, 0.2, 0.3, 0.4]
    invalid = asyncio.run(MetaInspector(Spark('{"box":[0.7,0.2,0.3,0.4],"confidence":"high"}')).analyze(b"image", "washer_fluid", "engine_candidate"))
    assert invalid.status == "uncertain"
    assert invalid.box is None
