from __future__ import annotations

import asyncio
import json
from datetime import date

import httpx

from carmori.config import Settings
from carmori.vehicle_recognition import MetaVehicleRecognizer, clean_exterior_color


def test_exterior_color_is_only_used_when_visible_and_recognizable():
    assert clean_exterior_color("Lunar Silver Metallic") == "Lunar Silver Metallic"
    assert clean_exterior_color("unclear") is None


def test_meta_vision_then_vin_decoder_without_storing_full_vin(monkeypatch):
    real_client = httpx.AsyncClient
    calls = []

    def handle(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if request.url.host == "api.meta.ai":
            body = json.loads(request.content)
            assert body["model"] == "muse-spark-1.3"
            assert body["messages"][0]["content"][1]["image_url"]["url"].startswith("data:image/jpeg;base64,")
            return httpx.Response(200, json={"choices": [{"message": {"content": '{"vin":"1HGCM82633A004352"}'}}]})
        assert request.url.host == "vpic.nhtsa.dot.gov"
        assert "1HGCM82633A004352" in request.url.path
        return httpx.Response(200, json={"Results": [{"ErrorCode": "0", "Make": "HONDA", "Model": "CIVIC", "ModelYear": "2003", "Trim": "EX"}]})

    def client_factory(*args, **kwargs):
        return real_client(*args, transport=httpx.MockTransport(handle), **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", client_factory)
    result = asyncio.run(MetaVehicleRecognizer(Settings(meta_api_key="test-key")).recognize(b"\xff\xd8image\xff\xd9", "vin"))
    assert result.status == "recognized"
    assert (result.make, result.model, result.year, result.vin_last4) == ("HONDA", "CIVIC", 2003, "4352")
    assert "1HGCM82633A004352" not in result.model_dump_json()
    assert len(calls) == 2


def test_meta_billing_error_is_actionable(monkeypatch):
    real_client = httpx.AsyncClient

    def client_factory(*args, **kwargs):
        return real_client(
            *args,
            transport=httpx.MockTransport(lambda request: httpx.Response(
                402,
                json={"error": {"code": "billing_not_configured"}},
                request=request,
            )),
            **kwargs,
        )

    monkeypatch.setattr(httpx, "AsyncClient", client_factory)
    result = asyncio.run(MetaVehicleRecognizer(Settings(meta_api_key="test-key")).recognize(b"\xff\xd8image\xff\xd9", "exterior"))
    assert result.status == "unavailable"
    assert "billing is not configured" in result.message


def test_meta_reads_pdf_inline_and_returns_only_vehicle_identity(monkeypatch):
    real_client = httpx.AsyncClient

    def handle(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        content = body["messages"][0]["content"]
        assert content[1]["type"] == "file"
        assert content[1]["file"]["file_data"].startswith("data:application/pdf;base64,")
        assert "owner names" in content[0]["text"]
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"make":"Ford","model":"Focus","year":2018,"vin":null}'}}]})

    def client_factory(*args, **kwargs):
        return real_client(*args, transport=httpx.MockTransport(handle), **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", client_factory)
    result = asyncio.run(MetaVehicleRecognizer(Settings(meta_api_key="test-key")).recognize_document(
        b"%PDF-1.7\nexample", "application/pdf", "buyers_guide",
    ))
    assert result.status == "recognized"
    assert result.source == "document"
    assert (result.make, result.model, result.year) == ("Ford", "Focus", 2018)


def test_bill_of_sale_date_is_candidate_but_window_sticker_date_is_ignored(monkeypatch):
    real_client = httpx.AsyncClient

    def handle(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        prompt = body["messages"][0]["content"][0]["text"]
        if "Bill of Sale" in prompt:
            assert "explicit date of sale" in prompt
        else:
            assert "Always leave sale_date null" in prompt
        return httpx.Response(200, json={"choices": [{"message": {"content":
            '{"make":"Honda","model":"Civic","year":2021,"sale_date":"2024-04-15"}'}}]})

    monkeypatch.setattr(httpx, "AsyncClient", lambda *args, **kwargs: real_client(
        *args, transport=httpx.MockTransport(handle), **kwargs,
    ))
    recognizer = MetaVehicleRecognizer(Settings(meta_api_key="test-key"))
    sale = asyncio.run(recognizer.recognize_document(b"%PDF-1.7\nexample", "application/pdf", "bill_of_sale"))
    sticker = asyncio.run(recognizer.recognize_document(b"%PDF-1.7\nexample", "application/pdf", "window_sticker"))
    assert sale.sale_date == date(2024, 4, 15)
    assert sticker.sale_date is None
