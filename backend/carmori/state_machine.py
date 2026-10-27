"""워셔액 보충 작업의 단계 전환 규칙.

transition()과 apply_voice()는 부작용 없는 순수 함수다. 시각(now)과 입력을 받아
새 상태·전환 사유·읽어줄 안내·완료 이벤트를 돌려준다. 모델 호출, 저장, TTS는
호출자(API 서버, 리플레이 하네스)가 맡는다.

전환 원칙(계획서 09·10절):
- 같은 조건이 겹치지 않는 프레임 묶음에서 연속 두 번 판단될 때만 전환한다.
- 손 접근, 시간 경과, 오래된·역순 응답으로는 전환하지 않는다.
- 투입구·제품 UNKNOWN은 음성으로 승인하지 않는다. 가려진 보충 동작만 음성 확인한다.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

from .hints import STEP_ENTRY_HINT, hint_text
from .models import (
    CapState,
    CompletionEvent,
    CompletionSource,
    Observation,
    Pending,
    SceneAnswer,
    SessionState,
    Step,
    Tri,
    VoiceIntent,
    WaitReason,
)
from .products import ProductVerdict, evaluate_product, normalize_label
from .vehicles import VehicleSpec


@dataclass(frozen=True)
class Rules:
    max_frame_age: timedelta = timedelta(seconds=6)
    required_agreements: int = 2


DEFAULT_RULES = Rules()


@dataclass(frozen=True)
class TransitionResult:
    state: SessionState
    accepted: bool
    reason: str
    spoken_hint: str | None = None
    completion: CompletionEvent | None = None


@dataclass(frozen=True)
class _Verdict:
    kind: Literal["satisfied", "not_yet", "wait", "regress"]
    hint_key: str | None = None
    key: str | None = None
    wait_reason: WaitReason | None = None
    flow_seen: bool = False


def new_session(session_id: str, vehicle_id: str) -> SessionState:
    return SessionState(
        session_id=session_id,
        vehicle_id=vehicle_id,
        last_hint_key=STEP_ENTRY_HINT[Step.FIND_INLET],
    )


def completion_event_id(session_id: str, attempt: int) -> str:
    return hashlib.sha1(f"{session_id}:{attempt}:washer_fluid_refill".encode()).hexdigest()[:16]


def transition(
    state: SessionState,
    obs: Observation,
    *,
    now: datetime,
    spec: VehicleSpec,
    rules: Rules = DEFAULT_RULES,
) -> TransitionResult:
    if state.step is Step.RECORDED:
        return _reject(state, "already_recorded")
    if state.paused:
        return _reject(state, "paused")
    if obs.session_id != state.session_id:
        return _reject(state, "session_mismatch")
    if obs.sequence_id <= state.last_sequence_id:
        return _reject(state, "out_of_order")
    if now - obs.captured_at > rules.max_frame_age:
        return _reject(state, "stale_frames")
    if obs.attempt != state.attempt or obs.step is not state.step:
        return _reject(state, "step_mismatch")
    if not obs.frame_ids:
        return _reject(state, "no_frames")

    state = state.model_copy(update={"last_sequence_id": obs.sequence_id})
    if state.waiting_reason is WaitReason.NEED_VOICE_CONFIRM:
        return _result(state, "awaiting_voice_confirm", None)

    verdict = _judge(state, obs.answer, spec)
    if verdict.flow_seen:
        state = state.model_copy(update={"pour_flow_observed": True})

    if verdict.kind == "regress":
        state = state.model_copy(
            update={
                "step": Step.CONFIRM_PRODUCT,
                "pending": None,
                "waiting_reason": WaitReason.PRODUCT_CONFLICT,
                "confirmed_product": None,
                "pour_flow_observed": False,
            }
        )
        return _result(state, "bottle_changed", verdict.hint_key)

    if verdict.kind == "wait":
        state = state.model_copy(update={"pending": None, "waiting_reason": verdict.wait_reason})
        return _result(state, f"waiting:{verdict.wait_reason.value}", verdict.hint_key)

    if verdict.kind == "not_yet":
        state = state.model_copy(update={"pending": None, "waiting_reason": None})
        return _result(state, "condition_not_met", verdict.hint_key)

    # satisfied: 겹치지 않는 묶음에서 같은 조건이 연속으로 나와야 한다.
    pending = state.pending
    if pending is not None and pending.key == verdict.key:
        if set(pending.frame_ids) & set(obs.frame_ids):
            return _result(state.model_copy(update={"waiting_reason": None}), "overlapping_frames", None)
        count = pending.count + 1
        frames = [*pending.frame_ids, *obs.frame_ids]
    else:
        count = 1
        frames = list(obs.frame_ids)

    if count < rules.required_agreements:
        state = state.model_copy(
            update={
                "pending": Pending(key=verdict.key, frame_ids=frames, count=count),
                "waiting_reason": None,
            }
        )
        return _result(state, "awaiting_agreement", None)

    return _advance(state, verdict.key, frames, obs, now)


def apply_voice(state: SessionState, intent: VoiceIntent, *, now: datetime) -> TransitionResult:
    if intent is VoiceIntent.PAUSE:
        return _result(state.model_copy(update={"paused": True, "pending": None}), "paused", "paused")

    if intent is VoiceIntent.RESUME:
        return _result(state.model_copy(update={"paused": False}), "resumed", "resumed", force=True)

    if intent is VoiceIntent.REPEAT:
        key = state.last_hint_key or STEP_ENTRY_HINT.get(state.step)
        return _result(state, "repeat", key, force=True)

    if intent is VoiceIntent.RESTART:
        fresh = SessionState(
            session_id=state.session_id,
            vehicle_id=state.vehicle_id,
            attempt=state.attempt + 1,
            last_sequence_id=state.last_sequence_id,
        )
        return _result(fresh, "restart", "restart", force=True)

    if intent is VoiceIntent.EDIT_RECORD:
        # 기록 수정은 /maintenance-records 경로에서 처리한다.
        return TransitionResult(state=state, accepted=True, reason="edit_requested")

    waiting_for_voice = state.waiting_reason is WaitReason.NEED_VOICE_CONFIRM
    if intent is VoiceIntent.CONFIRM_YES:
        if waiting_for_voice:
            return _complete(state, CompletionSource.USER_VOICE_CONFIRMED, now)
        if state.waiting_reason is not None:
            return _result(state, "voice_cannot_approve", "voice_cannot_approve", force=True, accepted=False)
        return _reject(state, "nothing_to_confirm")

    if intent is VoiceIntent.CONFIRM_NO:
        if waiting_for_voice:
            state = state.model_copy(
                update={
                    "step": Step.POUR,
                    "waiting_reason": None,
                    "pending": None,
                    "pour_flow_observed": False,
                }
            )
            return _result(state, "pour_not_done", "pour_again")
        return _reject(state, "nothing_to_confirm")

    raise ValueError(f"unhandled intent {intent}")


def _judge(state: SessionState, a: SceneAnswer, spec: VehicleSpec) -> _Verdict:
    step = state.step

    if step is Step.FIND_INLET:
        if a.occluded or a.inlet_visible is Tri.UNCLEAR:
            return _Verdict("wait", "inlet_occluded", wait_reason=WaitReason.OCCLUDED)
        if a.inlet_visible is Tri.YES and a.inlet_symbol_ok is Tri.NO:
            return _Verdict("wait", "wrong_part", wait_reason=WaitReason.WRONG_PART)
        if a.inlet_visible is Tri.YES and a.inlet_symbol_ok is Tri.YES:
            if a.cap_state is CapState.CLOSED:
                return _Verdict("satisfied", key="inlet_found")
            if a.cap_state is CapState.OPEN:
                # 닫힘 → 열림 변화를 볼 수 없으므로 닫힌 상태부터 다시 본다.
                return _Verdict("wait", "cap_already_open", wait_reason=WaitReason.CAP_ALREADY_OPEN)
        return _Verdict("not_yet", "inlet_find")

    if step is Step.OPEN_CAP:
        if a.occluded or a.cap_state in (CapState.OCCLUDED, CapState.NOT_VISIBLE):
            return _Verdict("wait", "cap_occluded", wait_reason=WaitReason.OCCLUDED)
        if a.cap_state is CapState.OPEN:
            return _Verdict("satisfied", key="cap_open")
        return _Verdict("not_yet", "open_cap")

    if step is Step.CONFIRM_PRODUCT:
        verdict = evaluate_product(a.label_text, a.product_class, spec)
        if verdict is ProductVerdict.MATCH:
            return _Verdict("satisfied", key=f"product:{normalize_label(a.label_text or '')}")
        if verdict is ProductVerdict.CONFLICT:
            return _Verdict("wait", "product_conflict", wait_reason=WaitReason.PRODUCT_CONFLICT)
        return _Verdict("wait", "product_unknown", wait_reason=WaitReason.PRODUCT_UNKNOWN)

    flow_seen = (
        a.bottle_over_inlet is Tri.YES and a.bottle_tilted is Tri.YES and a.flow_visible is Tri.YES
    )
    finished = a.cap_state is CapState.CLOSED and a.bottle_upright is Tri.YES

    if step is Step.POUR:
        if a.label_text and evaluate_product(a.label_text, a.product_class, spec) is not ProductVerdict.MATCH:
            return _Verdict("regress", "bottle_changed")
        if finished:
            # 붓는 모습은 못 봤지만 마무리는 보였다. 기록 전에 음성으로 확인한다.
            return _Verdict("satisfied", key="finished_unseen_pour")
        if a.occluded:
            return _Verdict("wait", "pour_occluded", wait_reason=WaitReason.OCCLUDED)
        if (
            a.bottle_over_inlet is Tri.YES
            and a.bottle_tilted is Tri.YES
            and a.flow_visible is not Tri.NO
        ):
            return _Verdict("satisfied", key="pour", flow_seen=flow_seen)
        return _Verdict("not_yet", "pour")

    if step is Step.FINISH:
        if finished:
            return _Verdict("satisfied", key="finished", flow_seen=flow_seen)
        if a.occluded or a.cap_state in (CapState.OCCLUDED, CapState.NOT_VISIBLE):
            return _Verdict("wait", "finish_occluded", wait_reason=WaitReason.OCCLUDED, flow_seen=flow_seen)
        return _Verdict("not_yet", "finish", flow_seen=flow_seen)

    raise ValueError(f"no rule for step {step}")


def _advance(
    state: SessionState, key: str, frames: list[str], obs: Observation, now: datetime
) -> TransitionResult:
    state = state.model_copy(
        update={
            "pending": None,
            "waiting_reason": None,
            "evidence_frames": [*state.evidence_frames, *frames],
        }
    )
    step = state.step

    if step is Step.FIND_INLET:
        return _goto(state, Step.OPEN_CAP, "inlet_found")
    if step is Step.OPEN_CAP:
        return _goto(state, Step.CONFIRM_PRODUCT, "cap_opened")
    if step is Step.CONFIRM_PRODUCT:
        state = state.model_copy(update={"confirmed_product": obs.answer.label_text})
        return _goto(state, Step.POUR, "product_matched")
    if step is Step.POUR and key == "pour":
        return _goto(state, Step.FINISH, "pour_observed")
    if (step is Step.POUR and key == "finished_unseen_pour") or (
        step is Step.FINISH and not state.pour_flow_observed
    ):
        state = state.model_copy(
            update={"step": Step.FINISH, "waiting_reason": WaitReason.NEED_VOICE_CONFIRM}
        )
        return _result(state, "pour_not_observed", "confirm_pour")
    if step is Step.FINISH:
        return _complete(state, CompletionSource.OBSERVED_SEQUENCE, now)

    raise ValueError(f"cannot advance from {step} with {key}")


def _goto(state: SessionState, step: Step, reason: str) -> TransitionResult:
    return _result(state.model_copy(update={"step": step}), reason, STEP_ENTRY_HINT[step])


def _complete(state: SessionState, source: CompletionSource, now: datetime) -> TransitionResult:
    event = CompletionEvent(
        completion_event_id=completion_event_id(state.session_id, state.attempt),
        session_id=state.session_id,
        vehicle_id=state.vehicle_id,
        completion_source=source,
        completed_at=now,
        evidence_frames=list(state.evidence_frames),
        product_label=state.confirmed_product,
        flow_observed=state.pour_flow_observed,
    )
    state = state.model_copy(
        update={"step": Step.RECORDED, "waiting_reason": None, "pending": None}
    )
    hint = "recorded_observed" if source is CompletionSource.OBSERVED_SEQUENCE else "recorded_voice"
    result = _result(state, f"recorded:{source.value}", hint)
    return TransitionResult(
        state=result.state,
        accepted=True,
        reason=result.reason,
        spoken_hint=result.spoken_hint,
        completion=event,
    )


def _result(
    state: SessionState,
    reason: str,
    hint_key: str | None,
    *,
    force: bool = False,
    accepted: bool = True,
) -> TransitionResult:
    """같은 안내를 관찰마다 반복해서 읽지 않도록, 바뀐 안내만 내보낸다."""
    if hint_key is None or (hint_key == state.last_hint_key and not force):
        return TransitionResult(state=state, accepted=accepted, reason=reason)
    state = state.model_copy(update={"last_hint_key": hint_key})
    return TransitionResult(state=state, accepted=accepted, reason=reason, spoken_hint=hint_text(hint_key))


def _reject(state: SessionState, reason: str) -> TransitionResult:
    return TransitionResult(state=state, accepted=False, reason=reason)
