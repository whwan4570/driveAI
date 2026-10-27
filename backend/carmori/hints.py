"""음성 안내 문구. 짧게 나눠 TTS로 읽는다. 시연 언어는 Day 1에 확정한다."""

from __future__ import annotations

from .models import Step

HINTS: dict[str, str] = {
    "inlet_find": "워셔액 투입구가 화면 가운데 보이게 해주세요.",
    "inlet_occluded": "투입구가 가려져 있어요. 손을 잠깐 옮겨주세요.",
    "wrong_part": "워셔액 투입구가 아닌 것 같아요. 와이퍼 표시가 있는 캡을 보여주세요.",
    "cap_already_open": "캡이 이미 열려 있어요. 캡을 닫아 주시면 처음부터 안내할게요.",
    "open_cap": "표시한 캡을 열어주세요.",
    "cap_occluded": "캡이 보이지 않아요. 손을 잠깐 옮겨주세요.",
    "show_product": "제품 라벨을 카메라에 보여주세요.",
    "product_conflict": "워셔액이 아닌 제품 같아요. 넣지 말고 라벨을 다시 확인해주세요.",
    "product_unknown": "라벨이 잘 보이지 않아요. 라벨을 카메라 쪽으로 보여주세요.",
    "pour": "확인했어요. 투입구에 천천히 보충해주세요.",
    "pour_occluded": "병과 투입구가 잘 보이지 않아요. 보이는 위치에서 보충해주세요.",
    "bottle_changed": "확인한 병과 다른 제품이에요. 라벨을 다시 보여주세요.",
    "finish": "다 넣으셨으면 병을 세우고 캡을 닫아주세요.",
    "finish_occluded": "캡이 보이지 않아요. 손을 잠깐 옮겨주세요.",
    "confirm_pour": "보충하는 모습이 잘 보이지 않았어요. 보충을 마쳤나요?",
    "pour_again": "알겠어요. 병이 투입구 위에 보이게 보충해주세요.",
    "recorded_observed": "관찰한 보충 작업을 기록했어요.",
    "recorded_voice": "말씀하신 대로 보충 작업을 기록했어요.",
    "voice_cannot_approve": "말로는 확인할 수 없어요. 카메라에 다시 보여주세요.",
    "paused": "잠시 멈출게요. 계속하려면 계속이라고 말해주세요.",
    "resumed": "다시 볼게요.",
    "restart": "처음부터 다시 할게요. 워셔액 투입구를 보여주세요.",
}

STEP_ENTRY_HINT: dict[Step, str] = {
    Step.FIND_INLET: "inlet_find",
    Step.OPEN_CAP: "open_cap",
    Step.CONFIRM_PRODUCT: "show_product",
    Step.POUR: "pour",
    Step.FINISH: "finish",
}


def hint_text(key: str) -> str:
    return HINTS[key]
