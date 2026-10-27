"""Muse Spark 호출 경계.

- analyze: 프레임 묶음 → SceneAnswer (Spark 1.3, 이미지 이해)
- transcribe: WAV → 텍스트 (Spark 1.2 오디오 경로)
- answer: 질문 + 사실 목록 → 답변과 근거 사실 id (Spark 1.3)

MetaSparkClient는 Day 1에 행사 계정에서 엔드포인트·모델 ID를 확인한 뒤 채운다.
그 전까지는 HappyPathSpark로 웹·서버 통합을 진행한다.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from pydantic import BaseModel

from .briefing import Fact
from .config import Settings
from .models import CapState, ProductClass, SceneAnswer, Step, Tri
from .prompts import build_scene_prompt, fields_for, parse_scene_answer


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
    """TODO(Day 1): https://dev.meta.ai/docs 기준으로 요청 형식을 구현한다."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.model_version = settings.spark_vision_model

    async def analyze(
        self, frames: Sequence[bytes], step: Step | None, reference: bytes | None = None
    ) -> SceneAnswer:
        prompt = build_scene_prompt(step, has_reference=reference is not None)
        images = [reference, *frames] if reference is not None else list(frames)
        raw = await self._vision_request(prompt, images)
        return parse_scene_answer(raw, fields_for(step))

    async def transcribe(self, wav: bytes) -> str:
        raise NotImplementedError("Day 1: Spark 1.2 오디오 요청 형식을 확인한 뒤 구현")

    async def answer(self, question: str, facts: Sequence[Fact]) -> AssistantAnswer:
        raise NotImplementedError("Day 1: Spark 1.3 텍스트 답변 요청을 구현")

    async def _vision_request(self, prompt: str, images: Sequence[bytes]) -> str:
        raise NotImplementedError("Day 1: Spark 1.3 이미지 요청 형식을 확인한 뒤 구현")


class HappyPathSpark:
    """모델 없이 웹·서버를 통합하기 위한 가짜 클라이언트.

    현재 단계의 조건을 항상 만족하는 답을 돌려준다. 실제 판정 품질과는 무관하다.
    """

    model_version = "fake-happy-path"

    _ANSWERS: dict[Step, SceneAnswer] = {
        Step.FIND_INLET: SceneAnswer(inlet_visible=Tri.YES, inlet_symbol_ok=Tri.YES, cap_state=CapState.CLOSED),
        Step.OPEN_CAP: SceneAnswer(cap_state=CapState.OPEN, hand_near_cap=Tri.YES),
        Step.CONFIRM_PRODUCT: SceneAnswer(label_text="사계절 워셔액", product_class=ProductClass.WASHER_FLUID),
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
            text="저장된 기록 기준으로 말씀드리면, " + " ".join(f.text for f in used),
            fact_ids=[f.id for f in used],
        )


def make_spark_client(settings: Settings) -> SparkClient:
    if settings.spark_mode == "meta":
        return MetaSparkClient(settings)
    return HappyPathSpark()
