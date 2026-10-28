"""Meta model calls for visual observations and grounded answers."""

from __future__ import annotations

from collections.abc import Sequence
import base64
import json
import logging
import time
from typing import Protocol

import httpx
from pydantic import BaseModel

from .briefing import Fact
from .config import Settings
from .models import CapState, ProductClass, SceneAnswer, Step, Tri
from .prompts import build_scene_prompt, fields_for, parse_scene_answer

log = logging.getLogger("carmori.spark")


class AssistantAnswer(BaseModel):
    text: str
    fact_ids: list[str]


class SparkClient(Protocol):
    model_version: str

    async def analyze(
        self, frames: Sequence[bytes], step: Step | None, reference: bytes | None = None
    ) -> SceneAnswer: ...

    async def transcribe(self, wav: bytes) -> str: ...

    async def answer(self, question: str, facts: Sequence[Fact]) -> AssistantAnswer: ...


class MetaSparkClient:
    """Server-side Muse Spark client. Model output never directly changes state."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.model_version = settings.spark_vision_model

    async def analyze(
        self, frames: Sequence[bytes], step: Step | None, reference: bytes | None = None
    ) -> SceneAnswer:
        prompt = build_scene_prompt(step, has_reference=reference is not None)
        images = [reference, *frames] if reference is not None else list(frames)
        raw = await self._vision_request(prompt, images, reasoning_effort=self.settings.spark_reasoning_effort or None)
        return parse_scene_answer(raw, fields_for(step))

    async def transcribe(self, wav: bytes) -> str:
        if not self.settings.meta_api_key:
            raise RuntimeError("Meta API key missing")
        base = self.settings.meta_api_base_url.rstrip("/") or "https://api.meta.ai/v1"
        request = {"mode": "PUSH_TO_TALK", "model": "muse-voice-transcribe-1.0", "audioEncoding": "WAV"}
        async with httpx.AsyncClient(timeout=max(30.0, self.settings.spark_timeout_s)) as client:
            response = await client.post(
                f"{base}/asr/transcribe",
                headers={"Authorization": f"Bearer {self.settings.meta_api_key}"},
                files={"request": (None, json.dumps(request), "application/json"), "audio": ("speech.wav", wav, "audio/wav")},
            )
            response.raise_for_status()
        transcript = response.json().get("transcript")
        return transcript.strip() if isinstance(transcript, str) else ""

    async def answer(self, question: str, facts: Sequence[Fact]) -> AssistantAnswer:
        payload = [{"id": fact.id, "text": fact.text, "source": fact.source} for fact in facts]
        prompt = (
            "Answer the user's vehicle question using ONLY the supplied facts. "
            "Say when a measurement or vehicle-specific guidance is unknown. "
            "Return only JSON with keys text (short string) and fact_ids (array of used fact ids). "
            "Never invent service intervals, fluid levels, tire condition, or repair safety.\n"
            f"Facts: {json.dumps(payload)}\nQuestion: {question}"
        )
        raw = await self._request([{"type": "text", "text": prompt}])
        try:
            parsed = json.loads(_strip_json(raw))
            return AssistantAnswer.model_validate(parsed)
        except (ValueError, TypeError):
            return AssistantAnswer(text="I cannot answer that from your saved records.", fact_ids=[])

    async def _vision_request(self, prompt: str, images: Sequence[bytes], *, reasoning_effort: str | None = None) -> str:
        content = [{"type": "text", "text": prompt}]
        content.extend({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64.b64encode(img).decode('ascii')}"}} for img in images)
        return await self._request(content, reasoning_effort=reasoning_effort)

    async def _request(self, content: list[dict], *, reasoning_effort: str | None = None) -> str:
        if not self.settings.meta_api_key:
            raise RuntimeError("Meta API key missing")
        base = self.settings.meta_api_base_url.rstrip("/") or "https://api.meta.ai/v1"
        payload: dict = {"model": self.settings.spark_vision_model, "messages": [{"role": "user", "content": content}]}
        if reasoning_effort:
            payload["reasoning_effort"] = reasoning_effort
        started = time.monotonic()
        async with httpx.AsyncClient(timeout=self.settings.spark_timeout_s) as client:
            response = await client.post(
                f"{base}/chat/completions",
                headers={"Authorization": f"Bearer {self.settings.meta_api_key}"},
                json=payload,
            )
            response.raise_for_status()
        body = response.json()
        usage = body.get("usage") or {}
        # Day 2 지연 측정용: 호출 시간과 추론 토큰 수를 남긴다.
        log.info(
            "spark %.2fs effort=%s images=%d prompt_tokens=%s completion_tokens=%s reasoning_tokens=%s",
            time.monotonic() - started, reasoning_effort or "default",
            sum(1 for part in content if part.get("type") == "image_url"),
            usage.get("prompt_tokens"), usage.get("completion_tokens"),
            (usage.get("completion_tokens_details") or {}).get("reasoning_tokens"),
        )
        message = body["choices"][0]["message"]["content"]
        if not isinstance(message, str):
            raise ValueError("Meta returned non-text content")
        return message


def _strip_json(raw: str) -> str:
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    return text


class HappyPathSpark:
    """모델 없이 웹·서버를 통합하기 위한 가짜 클라이언트.

    현재 단계의 조건을 항상 만족하는 답을 돌려준다. 실제 판정 품질과는 무관하다.
    """

    model_version = "fake-happy-path"

    _ANSWERS: dict[Step, SceneAnswer] = {
        Step.FIND_INLET: SceneAnswer(inlet_visible=Tri.YES, inlet_symbol_ok=Tri.YES, cap_state=CapState.CLOSED),
        Step.OPEN_CAP: SceneAnswer(cap_state=CapState.OPEN, hand_near_cap=Tri.YES),
        Step.CONFIRM_PRODUCT: SceneAnswer(label_text="All-season washer fluid", product_class=ProductClass.WASHER_FLUID),
        Step.POUR: SceneAnswer(bottle_over_inlet=Tri.YES, bottle_tilted=Tri.YES, flow_visible=Tri.YES),
        Step.FINISH: SceneAnswer(cap_state=CapState.CLOSED, bottle_upright=Tri.YES),
    }

    async def analyze(
        self, frames: Sequence[bytes], step: Step | None, reference: bytes | None = None
    ) -> SceneAnswer:
        return self._ANSWERS.get(step, SceneAnswer()) if step else SceneAnswer()

    async def transcribe(self, wav: bytes) -> str:
        return ""

    async def answer(self, question: str, facts: Sequence[Fact]) -> AssistantAnswer:
        used = [f for f in facts if f.id != "vehicle"]
        return AssistantAnswer(
            text="Based on your saved records, " + " ".join(f.text for f in used),
            fact_ids=[f.id for f in used],
        )


def make_spark_client(settings: Settings) -> SparkClient:
    if settings.spark_mode == "meta":
        return MetaSparkClient(settings)
    return HappyPathSpark()
