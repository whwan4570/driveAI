from __future__ import annotations

import asyncio

import httpx

from carmori.config import Settings
from carmori.models import Step, Tri
from carmori.prompts import STEP_FIELDS, build_scene_prompt
from carmori.spark import MetaSparkClient


def capture_requests(monkeypatch, reply: str) -> list[dict]:
    sent: list[dict] = []

    class FakeClient:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass

        async def post(self, url, headers=None, json=None, **kwargs):
            sent.append(json)
            body = {
                "choices": [{"message": {"content": reply}}],
                "usage": {"prompt_tokens": 900, "completion_tokens": 40, "completion_tokens_details": {"reasoning_tokens": 12}},
            }
            return httpx.Response(200, json=body, request=httpx.Request("POST", url))

    monkeypatch.setattr("carmori.spark.httpx.AsyncClient", FakeClient)
    return sent


def test_observation_sends_configured_reasoning_effort(monkeypatch):
    sent = capture_requests(monkeypatch, '{"occluded": false, "inlet_visible": "yes", "inlet_symbol_ok": "yes", "cap_state": "closed"}')
    client = MetaSparkClient(Settings(meta_api_key="k", spark_mode="meta"))
    answer = asyncio.run(client.analyze([b"\xff\xd8frame\xff\xd9"], Step.FIND_INLET))
    assert sent[0]["reasoning_effort"] == "minimal"
    assert answer.inlet_visible is Tri.YES


def test_empty_reasoning_effort_uses_model_default(monkeypatch):
    sent = capture_requests(monkeypatch, "{}")
    client = MetaSparkClient(Settings(meta_api_key="k", spark_mode="meta", spark_reasoning_effort=""))
    asyncio.run(client.analyze([b"\xff\xd8frame\xff\xd9"], Step.OPEN_CAP))
    assert "reasoning_effort" not in sent[0]


def test_photo_inspection_keeps_model_default_effort(monkeypatch):
    sent = capture_requests(monkeypatch, "{}")
    client = MetaSparkClient(Settings(meta_api_key="k", spark_mode="meta"))
    asyncio.run(client._vision_request("inspect", [b"\xff\xd8x\xff\xd9"]))
    assert "reasoning_effort" not in sent[0]


def test_scene_prompt_lists_only_step_fields_and_stays_short():
    for step, fields in STEP_FIELDS.items():
        prompt = build_scene_prompt(step, has_reference=True)
        listed = [line.split(":", 1)[0] for line in prompt.splitlines()[3:]]
        assert listed == list(fields)
        assert "Image 1 is the last confirmed step" in prompt
        assert len(prompt) < 1000
