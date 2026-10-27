"""도메인 모델.

관찰(Observation)은 Spark가 한 프레임 묶음에 대해 답한 구조화 결과다.
SessionState는 서버만 바꾸며, 바뀔 때는 state_machine.transition()을 거친다.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class Tri(str, Enum):
    YES = "yes"
    NO = "no"
    UNCLEAR = "unclear"


class CapState(str, Enum):
    CLOSED = "closed"
    OPEN = "open"
    OCCLUDED = "occluded"
    NOT_VISIBLE = "not_visible"


class ProductClass(str, Enum):
    WASHER_FLUID = "washer_fluid"
    COOLANT = "coolant"
    OIL = "oil"
    OTHER = "other"
    UNREADABLE = "unreadable"


class Step(str, Enum):
    FIND_INLET = "FIND_INLET"
    OPEN_CAP = "OPEN_CAP"
    CONFIRM_PRODUCT = "CONFIRM_PRODUCT"
    POUR = "POUR"
    FINISH = "FINISH"
    RECORDED = "RECORDED"


class WaitReason(str, Enum):
    OCCLUDED = "OCCLUDED"
    WRONG_PART = "WRONG_PART"
    CAP_ALREADY_OPEN = "CAP_ALREADY_OPEN"
    PRODUCT_CONFLICT = "PRODUCT_CONFLICT"
    PRODUCT_UNKNOWN = "PRODUCT_UNKNOWN"
    NEED_VOICE_CONFIRM = "NEED_VOICE_CONFIRM"


class CompletionSource(str, Enum):
    OBSERVED_SEQUENCE = "observed_sequence"
    USER_VOICE_CONFIRMED = "user_voice_confirmed"
    MANUAL_ENTRY = "manual_entry"


class VoiceIntent(str, Enum):
    PAUSE = "PAUSE"
    RESUME = "RESUME"
    REPEAT = "REPEAT"
    RESTART = "RESTART"
    CONFIRM_YES = "CONFIRM_YES"
    CONFIRM_NO = "CONFIRM_NO"
    EDIT_RECORD = "EDIT_RECORD"


class SceneAnswer(BaseModel):
    """Spark의 구조화 응답. 모르는 항목은 unclear/not_visible로 둔다."""

    occluded: bool = False
    inlet_visible: Tri = Tri.UNCLEAR
    inlet_symbol_ok: Tri = Tri.UNCLEAR
    cap_state: CapState = CapState.NOT_VISIBLE
    # 기록용. 손이 가까이 있다는 사실은 어떤 전환의 근거도 되지 않는다.
    hand_near_cap: Tri = Tri.UNCLEAR
    label_text: str | None = None
    product_class: ProductClass = ProductClass.UNREADABLE
    bottle_over_inlet: Tri = Tri.UNCLEAR
    bottle_tilted: Tri = Tri.UNCLEAR
    flow_visible: Tri = Tri.UNCLEAR
    bottle_upright: Tri = Tri.UNCLEAR


class Observation(BaseModel):
    session_id: str
    sequence_id: int
    # 요청 시점의 단계·시도 번호. 응답이 늦게 와서 단계가 바뀌었으면 버린다.
    step: Step
    attempt: int
    captured_at: datetime
    frame_ids: list[str]
    answer: SceneAnswer
    model_version: str = "unknown"
    # 화면 표시용 영역(SAM/Spark 박스). 판정에는 쓰지 않는다.
    regions: dict[str, list[float]] = Field(default_factory=dict)


class Pending(BaseModel):
    model_config = ConfigDict(frozen=True)

    key: str
    frame_ids: list[str]
    count: int


class SessionState(BaseModel):
    model_config = ConfigDict(frozen=True)

    session_id: str
    vehicle_id: str
    step: Step = Step.FIND_INLET
    attempt: int = 1
    last_sequence_id: int = -1
    pending: Pending | None = None
    waiting_reason: WaitReason | None = None
    confirmed_product: str | None = None
    pour_flow_observed: bool = False
    evidence_frames: list[str] = Field(default_factory=list)
    last_hint_key: str | None = None
    paused: bool = False


class CompletionEvent(BaseModel):
    completion_event_id: str
    session_id: str
    vehicle_id: str
    task: str = "washer_fluid_refill"
    completion_source: CompletionSource
    completed_at: datetime
    evidence_frames: list[str]
    product_label: str | None
    flow_observed: bool


class VehicleProfile(BaseModel):
    vehicle_id: str
    spec_id: str
    year: int
    odometer_km: int | None = None
    created_at: datetime


class MaintenanceRecord(BaseModel):
    record_id: str
    vehicle_id: str
    task: str = "washer_fluid_refill"
    completed_at: datetime
    completion_source: CompletionSource
    completion_event_id: str | None = None
    session_id: str | None = None
    evidence_frames: list[str] = Field(default_factory=list)
    product_label: str | None = None
    flow_observed: bool = False
    model_version: str | None = None
    notes: str | None = None
    revision: int = 1
