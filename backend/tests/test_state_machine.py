from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from carmori.models import (
    CapState,
    CompletionSource,
    Observation,
    ProductClass,
    SceneAnswer,
    SessionState,
    Step,
    Tri,
    VoiceIntent,
    WaitReason,
)
from carmori.prompts import parse_scene_answer
from carmori.state_machine import apply_voice, completion_event_id, new_session, transition
from carmori.vehicles import DEMO_SPEC

T0 = datetime(2026, 10, 27, 9, 0, tzinfo=timezone.utc)

INLET = SceneAnswer(inlet_visible=Tri.YES, inlet_symbol_ok=Tri.YES, cap_state=CapState.CLOSED)
OPEN = SceneAnswer(cap_state=CapState.OPEN)


class Driver:
    """관찰을 순서대로 넣는 도우미. 프레임 id는 매번 새로 만든다."""

    def __init__(self, state: SessionState | None = None) -> None:
        self.state = state or new_session("s1", "v1")
        self.seq = 0
        self.t = 0.0
        self.last = None

    def obs(self, answer: SceneAnswer, *, frames: list[str] | None = None, seq: int | None = None,
            age_s: float = 2.0):
        self.seq = seq if seq is not None else self.seq + 1
        self.t += 1
        frame_ids = frames or [f"f{self.seq}a", f"f{self.seq}b"]
        captured = T0 + timedelta(seconds=self.t)
        obs = Observation(
            session_id=self.state.session_id,
            sequence_id=self.seq,
            step=self.state.step,
            attempt=self.state.attempt,
            captured_at=captured,
            frame_ids=frame_ids,
            answer=answer,
        )
        self.last = transition(self.state, obs, now=captured + timedelta(seconds=age_s), spec=DEMO_SPEC)
        self.state = self.last.state
        return self.last

    def voice(self, intent: VoiceIntent):
        self.last = apply_voice(self.state, intent, now=T0 + timedelta(seconds=self.t))
        self.state = self.last.state
        return self.last


def at_open_cap() -> Driver:
    d = Driver()
    d.obs(INLET)
    d.obs(INLET)
    assert d.state.step is Step.OPEN_CAP
    return d


def test_single_window_does_not_advance():
    d = Driver()
    r = d.obs(INLET)
    assert r.reason == "awaiting_agreement"
    assert d.state.step is Step.FIND_INLET
    assert r.spoken_hint is None


def test_two_disjoint_windows_advance_and_speak_next_hint():
    d = Driver()
    d.obs(INLET)
    r = d.obs(INLET)
    assert d.state.step is Step.OPEN_CAP
    assert r.spoken_hint == "Open the cap I marked."


def test_overlapping_frames_are_not_independent_confirmation():
    d = at_open_cap()
    d.obs(OPEN, frames=["x1", "x2"])
    r = d.obs(OPEN, frames=["x2", "x3"])
    assert r.reason == "overlapping_frames"
    assert d.state.step is Step.OPEN_CAP
    d.obs(OPEN, frames=["x4", "x5"])
    assert d.state.step is Step.CONFIRM_PRODUCT


def test_hand_near_closed_cap_never_advances():
    d = at_open_cap()
    for _ in range(5):
        d.obs(SceneAnswer(cap_state=CapState.CLOSED, hand_near_cap=Tri.YES))
    assert d.state.step is Step.OPEN_CAP


def test_occlusion_breaks_the_consecutive_run():
    d = at_open_cap()
    d.obs(OPEN)
    r = d.obs(SceneAnswer(occluded=True, cap_state=CapState.OCCLUDED))
    assert d.state.waiting_reason is WaitReason.OCCLUDED
    assert r.spoken_hint == "I cannot see the cap. Move your hand aside for a moment."
    d.obs(OPEN)
    assert d.state.step is Step.OPEN_CAP


def test_out_of_order_and_stale_and_step_mismatch_are_rejected():
    d = at_open_cap()
    d.obs(OPEN, seq=10)
    assert d.obs(OPEN, seq=9).reason == "out_of_order"
    assert d.obs(OPEN, seq=11, age_s=30).reason == "stale_frames"

    obs = Observation(
        session_id="s1", sequence_id=12, step=Step.FIND_INLET, attempt=1,
        captured_at=T0, frame_ids=["z1"], answer=OPEN,
    )
    r = transition(d.state, obs, now=T0 + timedelta(seconds=1), spec=DEMO_SPEC)
    assert (r.accepted, r.reason) == (False, "step_mismatch")


def test_same_hint_is_not_repeated_but_repeat_intent_forces_it():
    d = at_open_cap()
    closed = SceneAnswer(cap_state=CapState.CLOSED)
    assert d.obs(closed).spoken_hint is None  # 진입 때 이미 읽었다
    assert d.voice(VoiceIntent.REPEAT).spoken_hint == "Open the cap I marked."


@pytest.mark.parametrize(
    ("label", "cls", "wait"),
    [
        ("엔진 냉각수", ProductClass.COOLANT, WaitReason.PRODUCT_CONFLICT),
        ("Brake Fluid DOT4", ProductClass.OTHER, WaitReason.PRODUCT_CONFLICT),
        (None, ProductClass.UNREADABLE, WaitReason.PRODUCT_UNKNOWN),
        ("사계절 워셔액", ProductClass.OTHER, WaitReason.PRODUCT_UNKNOWN),
    ],
)
def test_product_not_matched_waits(label, cls, wait):
    d = at_open_cap()
    d.obs(OPEN)
    d.obs(OPEN)
    d.obs(SceneAnswer(label_text=label, product_class=cls))
    assert d.state.step is Step.CONFIRM_PRODUCT
    assert d.state.waiting_reason is wait


def test_voice_cannot_approve_unknown_product():
    d = at_open_cap()
    d.obs(OPEN)
    d.obs(OPEN)
    d.obs(SceneAnswer(product_class=ProductClass.UNREADABLE))
    r = d.voice(VoiceIntent.CONFIRM_YES)
    assert not r.accepted and r.reason == "voice_cannot_approve"
    assert r.completion is None
    assert d.state.step is Step.CONFIRM_PRODUCT


def at_pour() -> Driver:
    d = at_open_cap()
    d.obs(OPEN)
    d.obs(OPEN)
    washer = SceneAnswer(label_text="사계절 워셔액", product_class=ProductClass.WASHER_FLUID)
    d.obs(washer)
    d.obs(washer)
    assert d.state.step is Step.POUR
    assert d.state.confirmed_product == "사계절 워셔액"
    return d


POUR_FLOW = SceneAnswer(bottle_over_inlet=Tri.YES, bottle_tilted=Tri.YES, flow_visible=Tri.YES)
DONE = SceneAnswer(cap_state=CapState.CLOSED, bottle_upright=Tri.YES)


def test_full_observed_sequence_waits_for_user_confirmation_then_records_once():
    d = at_pour()
    d.obs(POUR_FLOW)
    d.obs(POUR_FLOW)
    assert d.state.step is Step.FINISH
    d.obs(DONE)
    r = d.obs(DONE)
    assert d.state.step is Step.FINISH
    assert d.state.waiting_reason is WaitReason.NEED_VOICE_CONFIRM
    assert r.completion is None
    r = d.voice(VoiceIntent.CONFIRM_YES)
    assert d.state.step is Step.RECORDED
    assert r.completion is not None
    assert r.completion.completion_source is CompletionSource.USER_VOICE_CONFIRMED
    assert r.completion.completion_event_id == completion_event_id("s1", 1)
    assert r.completion.flow_observed
    assert len(r.completion.evidence_frames) == 20  # 전환 5번 × 확인 묶음 2개 × 프레임 2장
    assert d.obs(DONE).reason == "already_recorded"


def test_tilt_without_visible_flow_needs_voice_confirmation():
    d = at_pour()
    tilt = SceneAnswer(bottle_over_inlet=Tri.YES, bottle_tilted=Tri.YES, flow_visible=Tri.UNCLEAR)
    d.obs(tilt)
    d.obs(tilt)
    d.obs(DONE)
    r = d.obs(DONE)
    assert d.state.waiting_reason is WaitReason.NEED_VOICE_CONFIRM
    assert r.completion is None
    assert r.spoken_hint == "The pour was out of view. Did you finish refilling?"
    r = d.voice(VoiceIntent.CONFIRM_YES)
    assert r.completion is not None
    assert r.completion.completion_source is CompletionSource.USER_VOICE_CONFIRMED


def test_voice_no_returns_to_pour():
    d = at_pour()
    d.obs(DONE)
    d.obs(DONE)
    assert d.state.waiting_reason is WaitReason.NEED_VOICE_CONFIRM
    r = d.voice(VoiceIntent.CONFIRM_NO)
    assert d.state.step is Step.POUR and d.state.waiting_reason is None
    assert r.completion is None


def test_empty_bottle_tilt_is_not_pour_evidence():
    d = at_pour()
    empty = SceneAnswer(bottle_over_inlet=Tri.YES, bottle_tilted=Tri.YES, flow_visible=Tri.NO)
    for _ in range(4):
        d.obs(empty)
    assert d.state.step is Step.POUR


def test_bottle_swap_during_pour_goes_back_to_product_check():
    d = at_pour()
    r = d.obs(POUR_FLOW.model_copy(update={"label_text": "냉각수", "product_class": ProductClass.COOLANT}))
    assert r.reason == "bottle_changed"
    assert d.state.step is Step.CONFIRM_PRODUCT
    assert d.state.confirmed_product is None


def test_pause_blocks_observations_until_resume():
    d = at_open_cap()
    d.voice(VoiceIntent.PAUSE)
    assert d.obs(OPEN).reason == "paused"
    d.voice(VoiceIntent.RESUME)
    d.obs(OPEN)
    d.obs(OPEN)
    assert d.state.step is Step.CONFIRM_PRODUCT


def test_restart_bumps_attempt_and_drops_in_flight_answers():
    d = at_open_cap()
    old_attempt_obs = Observation(
        session_id="s1", sequence_id=99, step=Step.OPEN_CAP, attempt=1,
        captured_at=T0 + timedelta(seconds=d.t), frame_ids=["late"], answer=OPEN,
    )
    d.voice(VoiceIntent.RESTART)
    assert d.state.step is Step.FIND_INLET and d.state.attempt == 2
    r = transition(d.state, old_attempt_obs, now=T0 + timedelta(seconds=d.t + 1), spec=DEMO_SPEC)
    assert r.reason == "step_mismatch"
    assert completion_event_id("s1", 2) != completion_event_id("s1", 1)


def test_parse_scene_answer_is_strict():
    ok = parse_scene_answer('```json\n{"cap_state": "open", "extra": 1}\n```', ["cap_state"])
    assert ok.cap_state is CapState.OPEN and not ok.occluded
    assert parse_scene_answer("not json").occluded
    assert parse_scene_answer('{"cap_state": "ajar"}').occluded
    # 묻지 않은 항목은 무시한다.
    assert parse_scene_answer('{"bottle_tilted": "yes"}', ["cap_state"]).bottle_tilted is Tri.UNCLEAR
