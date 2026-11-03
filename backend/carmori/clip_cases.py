"""Real-clip test set: what to shoot and the result a person expects to see.

Each clip starts from the first guide step, so it must show every step before the case itself.
Expected results are decided here by people, never from model answers.
"""

from __future__ import annotations

from dataclasses import dataclass

from .models import CompletionSource, Step, WaitReason


@dataclass(frozen=True)
class ClipCase:
    id: str
    checks: str
    shoot: str
    final_step: Step
    seconds: int
    takes: int = 1
    completion_source: CompletionSource | None = None
    waiting_reason: WaitReason | None = None


_TO_LABEL = "Show the closed cap, open it, then"
_TO_POUR = "Show the closed cap, open it, show the washer fluid label, then"

CASES: tuple[ClipCase, ...] = (
    ClipCase("normal", "A real refill is recorded from what the camera saw",
             f"{_TO_POUR} pour with the flow visible, stand the bottle up, and close the cap.",
             Step.RECORDED, 40, takes=3, completion_source=CompletionSource.OBSERVED_SEQUENCE),
    ClipCase("closed_cap_only", "A closed cap alone does not advance past opening",
             "Show the closed cap and touch nothing until the end.", Step.OPEN_CAP, 10),
    ClipCase("hand_only", "A hand near the cap is not an opened cap",
             "Show the closed cap, then rest a hand on or beside it. Do not open it.", Step.OPEN_CAP, 15),
    ClipCase("cap_blocked", "A hidden cap never counts as opened",
             "Show the closed cap, then keep a hand over it until the end. Do not open it.",
             Step.OPEN_CAP, 15, waiting_reason=WaitReason.OCCLUDED),
    ClipCase("cap_blocked_then_open", "The guide recovers after the view clears",
             "Show the closed cap, cover it for 5 seconds, then uncover and open it. Keep it in view.",
             Step.CONFIRM_PRODUCT, 25),
    ClipCase("coffee_cup", "A non-automotive item is not accepted as a product",
             f"{_TO_LABEL} hold up a coffee cup until the end.",
             Step.CONFIRM_PRODUCT, 25, waiting_reason=WaitReason.PRODUCT_CONFLICT),
    ClipCase("coolant_bottle", "A different automotive fluid is refused",
             f"{_TO_LABEL} hold up a coolant or oil label until the end.",
             Step.CONFIRM_PRODUCT, 25, waiting_reason=WaitReason.PRODUCT_CONFLICT),
    ClipCase("label_hidden", "An unreadable label waits instead of passing",
             f"{_TO_LABEL} hold the washer bottle with its label turned away until the end.",
             Step.CONFIRM_PRODUCT, 25, waiting_reason=WaitReason.PRODUCT_UNKNOWN),
    ClipCase("bottle_swap", "Changing bottles during the pour goes back to the label check",
             f"{_TO_POUR} tilt an EMPTY coolant or oil bottle over the inlet with its label visible. Pour nothing.",
             Step.CONFIRM_PRODUCT, 30, waiting_reason=WaitReason.PRODUCT_CONFLICT),
    ClipCase("empty_bottle_pour", "A pretend pour is not recorded as observed",
             f"{_TO_POUR} tilt an empty bottle with no flow, stand it up, and close the cap.",
             Step.FINISH, 40, waiting_reason=WaitReason.NEED_VOICE_CONFIRM),
    ClipCase("pour_flow_hidden", "A pour out of view asks the driver instead of recording",
             f"{_TO_POUR} pour with your hand or the bottle blocking the flow, stand it up, and close the cap.",
             Step.FINISH, 40, waiting_reason=WaitReason.NEED_VOICE_CONFIRM),
    ClipCase("cap_left_open", "A refill is not finished while the cap is open",
             f"{_TO_POUR} pour with the flow visible, stand the bottle up, and leave the cap open.",
             Step.FINISH, 35),
)

CASES_BY_ID = {case.id: case for case in CASES}


def clip_name(case_id: str, take: int) -> str:
    return f"{case_id}_{take:02d}"
