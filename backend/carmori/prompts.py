"""Spark에 보내는 단계별 질문.

실시간 경로에서는 현재 단계에 필요한 항목만 묻는다(step 지정).
리플레이용 클립을 만들 때는 모든 항목을 묻는다(step=None). 그래야 전환 규칙을
바꿔도 같은 캐시 응답으로 다시 돌려볼 수 있다.
"""

from __future__ import annotations

import json
from collections.abc import Iterable

from pydantic import ValidationError

from .models import SceneAnswer, Step

# 짧을수록 응답이 빠르다. 값 목록은 SceneAnswer와 맞춘다.
FIELD_GUIDE: dict[str, str] = {
    "occluded": "true|false: something blocks the inlet so its state can't be judged",
    "inlet_visible": "yes|no|unclear: washer inlet cap in view",
    "inlet_symbol_ok": "yes|no|unclear: cap shows the windshield-washer symbol",
    "inlet_shape_ok": "yes|no|unclear: blue cap clearly attached to a narrow white/translucent washer filler neck; color alone is unclear",
    "cap_state": "closed|open|occluded|not_visible",
    "hand_near_cap": "yes|no|unclear: hand touching or next to the cap",
    "label_text": "exact readable label text, or null",
    "product_class": "washer_fluid|coolant|oil|other|unreadable: from the label or item, not color; other if clearly not washer fluid; unreadable if you cannot tell",
    "bottle_over_inlet": "yes|no|unclear: bottle mouth above the open inlet",
    "bottle_tilted": "yes|no|unclear: bottle tilted to pour",
    "flow_visible": "yes|no|unclear: liquid visibly flowing into the inlet",
    "bottle_upright": "yes|no|unclear: bottle set upright away from the inlet",
}

STEP_FIELDS: dict[Step, tuple[str, ...]] = {
    Step.FIND_INLET: ("occluded", "inlet_visible", "inlet_symbol_ok", "inlet_shape_ok", "cap_state"),
    Step.OPEN_CAP: ("occluded", "cap_state", "hand_near_cap"),
    Step.CONFIRM_PRODUCT: ("occluded", "label_text", "product_class"),
    Step.POUR: (
        "occluded",
        "bottle_over_inlet",
        "bottle_tilted",
        "flow_visible",
        "label_text",
        "product_class",
        "cap_state",
        "bottle_upright",
    ),
    Step.FINISH: (
        "occluded",
        "cap_state",
        "bottle_upright",
        "bottle_over_inlet",
        "bottle_tilted",
        "flow_visible",
    ),
}

ALL_FIELDS: tuple[str, ...] = tuple(FIELD_GUIDE)


def fields_for(step: Step | None) -> tuple[str, ...]:
    return ALL_FIELDS if step is None else STEP_FIELDS[step]


def build_scene_prompt(step: Step | None, *, has_reference: bool) -> str:
    fields = fields_for(step)
    reference = " Image 1 is the last confirmed step; compare cap_state with it." if has_reference else ""
    guidance = ("Check image edges. A washer cap may be blue on a narrow white filler neck; color alone is not enough. "
                "Exclude oil, coolant, radiator and brake caps." if step is Step.FIND_INLET else
                "Report only what is visible; use unclear when unsure.")
    return "\n".join([
        f"Fixed camera at a car engine bay during a washer fluid refill. Frames are in time order.{reference}",
        guidance,
        "Reply with only one JSON object, no other text, with these keys:",
        *(f"{name}: {FIELD_GUIDE[name]}" for name in fields),
    ])


def parse_scene_answer(raw: str, allowed: Iterable[str] = ALL_FIELDS) -> SceneAnswer:
    """모델 응답을 SceneAnswer로 바꾼다. 형식이 틀리면 모두 unclear로 둔다."""
    text = raw.strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text.split("\n", 1)[1] if "\n" in text else ""
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return SceneAnswer(occluded=True)
    if not isinstance(data, dict):
        return SceneAnswer(occluded=True)

    allowed_set = set(allowed)
    kept = {k: v for k, v in data.items() if k in allowed_set}
    try:
        return SceneAnswer.model_validate(kept)
    except ValidationError:
        # 항목 하나라도 형식이 틀리면 그 응답 전체를 믿지 않는다.
        return SceneAnswer(occluded=True)
