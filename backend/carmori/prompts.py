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

FIELD_GUIDE: dict[str, str] = {
    "occluded": "true if hands or objects block the washer inlet area so the key state cannot be judged",
    "inlet_visible": "yes|no|unclear — the washer fluid inlet cap is in view",
    "inlet_symbol_ok": "yes|no|unclear — the cap shows the windshield-washer symbol",
    "cap_state": "closed|open|occluded|not_visible — compare with the reference frame if given",
    "hand_near_cap": "yes|no|unclear — a hand is touching or next to the cap",
    "label_text": "exact readable text on the product label, or null",
    "product_class": "washer_fluid|coolant|oil|other|unreadable — judged from the label only",
    "bottle_over_inlet": "yes|no|unclear — the bottle mouth is above the open inlet",
    "bottle_tilted": "yes|no|unclear — the bottle is tilted for pouring",
    "flow_visible": "yes|no|unclear — liquid is visibly flowing from the bottle into the inlet",
    "bottle_upright": "yes|no|unclear — the bottle is set upright away from the inlet",
}

STEP_FIELDS: dict[Step, tuple[str, ...]] = {
    Step.FIND_INLET: ("occluded", "inlet_visible", "inlet_symbol_ok", "cap_state"),
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
    lines = [
        "You are watching a fixed phone camera next to a car engine bay while a person refills washer fluid.",
        "The images are consecutive frames in time order.",
    ]
    if has_reference:
        lines.append("The first image is a reference frame from the previous confirmed step.")
    lines += [
        "Answer only what is directly visible. If you cannot see it, answer unclear.",
        "Do not infer fluid level, amount poured, or whether the car is fine.",
        "Return one JSON object with exactly these keys:",
        *(f'- "{name}": {FIELD_GUIDE[name]}' for name in fields),
    ]
    return "\n".join(lines)


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
