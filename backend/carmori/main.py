"""FastAPI 서버. 상태는 state_machine만 바꾸고, 여기서는 입출력과 저장만 한다.

실행: uvicorn carmori.main:app --reload
"""

from __future__ import annotations

import asyncio
import base64
import uuid
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import Body, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .briefing import (
    build_facts,
    is_memory_question,
    needs_check,
    render_briefing,
    render_memory_answer,
)
from .config import Settings
from .hints import STEP_ENTRY_HINT, hint_text
from .models import (
    CompletionSource,
    MaintenanceRecord,
    Observation,
    SceneAnswer,
    SessionState,
    Step,
    VehicleProfile,
    VoiceIntent,
    WaitReason,
)
from .spark import SparkClient, make_spark_client
from .state_machine import TransitionResult, apply_voice, new_session, transition
from .store import MemoryStore, Store
from .vehicles import SUPPORTED_SPECS, VehicleSpec, get_spec
from .weather import fetch_weather


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class FrameIn(BaseModel):
    frame_id: str
    captured_at: datetime
    jpeg_base64: str


class WindowIn(BaseModel):
    sequence_id: int
    frames: list[FrameIn] = Field(min_length=1, max_length=6)


class ObservationsIn(BaseModel):
    # 겹치지 않는 묶음 1~2개. 2개면 Spark를 동시에 호출해 확인 지연을 줄인다.
    windows: list[WindowIn] = Field(min_length=1, max_length=2)


class SessionView(BaseModel):
    session_id: str
    vehicle_id: str
    step: Step
    attempt: int
    waiting_reason: WaitReason | None
    paused: bool

    @classmethod
    def of(cls, s: SessionState) -> SessionView:
        return cls(
            session_id=s.session_id,
            vehicle_id=s.vehicle_id,
            step=s.step,
            attempt=s.attempt,
            waiting_reason=s.waiting_reason,
            paused=s.paused,
        )


class WindowResult(BaseModel):
    sequence_id: int
    accepted: bool
    reason: str
    answer: SceneAnswer | None


class SessionUpdate(BaseModel):
    session: SessionView
    transition_reason: str
    spoken_hint: str | None
    record: MaintenanceRecord | None = None
    windows: list[WindowResult] = Field(default_factory=list)


class VehicleIn(BaseModel):
    spec_id: str
    year: int
    odometer_km: int | None = None
    last_refill_at: datetime | None = None


class SessionIn(BaseModel):
    vehicle_id: str


class VoiceIn(BaseModel):
    intent: VoiceIntent


class AskIn(BaseModel):
    vehicle_id: str
    question: str


class AskOut(BaseModel):
    text: str
    fact_ids: list[str]


class BriefingIn(BaseModel):
    vehicle_id: str
    lat: float | None = None
    lon: float | None = None


class BriefingOut(BaseModel):
    text: str
    facts: list[dict]


class ManualRecordIn(BaseModel):
    vehicle_id: str
    completed_at: datetime
    notes: str | None = None


def create_app(
    settings: Settings | None = None,
    spark: SparkClient | None = None,
    store: Store | None = None,
) -> FastAPI:
    settings = settings or Settings.from_env()
    spark = spark or make_spark_client(settings)
    store = store or MemoryStore()
    locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
    reference_frames: dict[str, bytes] = {}

    app = FastAPI(title="Carmori")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def vehicle_or_404(vehicle_id: str) -> tuple[VehicleProfile, VehicleSpec]:
        vehicle = store.get_vehicle(vehicle_id)
        spec = get_spec(vehicle.spec_id) if vehicle else None
        if vehicle is None or spec is None:
            raise HTTPException(404, "vehicle not found")
        return vehicle, spec

    def session_or_404(session_id: str) -> SessionState:
        state = store.get_session(session_id)
        if state is None:
            raise HTTPException(404, "session not found")
        return state

    def save_result(result: TransitionResult) -> MaintenanceRecord | None:
        store.save_session(result.state)
        if result.completion is None:
            return None
        record, _created = store.save_completion(result.completion, spark.model_version)
        return record

    @app.get("/health")
    def health() -> dict:
        return {"ok": True, "spark": spark.model_version}

    @app.get("/vehicle-specs")
    def vehicle_specs() -> list[dict]:
        return [
            {"spec_id": s.spec_id, "display_name": s.display_name, "years": list(s.years)}
            for s in SUPPORTED_SPECS.values()
        ]

    @app.post("/vehicles")
    def create_vehicle(body: VehicleIn) -> VehicleProfile:
        spec = get_spec(body.spec_id)
        if spec is None or not spec.years[0] <= body.year <= spec.years[1]:
            raise HTTPException(422, "unsupported vehicle")
        vehicle = VehicleProfile(
            vehicle_id=uuid.uuid4().hex,
            spec_id=spec.spec_id,
            year=body.year,
            odometer_km=body.odometer_km,
            created_at=utcnow(),
        )
        store.save_vehicle(vehicle)
        if body.last_refill_at is not None:
            store.add_record(
                MaintenanceRecord(
                    record_id=uuid.uuid4().hex,
                    vehicle_id=vehicle.vehicle_id,
                    completed_at=body.last_refill_at,
                    completion_source=CompletionSource.MANUAL_ENTRY,
                )
            )
        return vehicle

    @app.get("/vehicles/{vehicle_id}/memory")
    def vehicle_memory(vehicle_id: str) -> list[MaintenanceRecord]:
        vehicle_or_404(vehicle_id)
        return store.list_records(vehicle_id)

    @app.post("/maintenance-records")
    def create_manual_record(body: ManualRecordIn) -> MaintenanceRecord:
        vehicle_or_404(body.vehicle_id)
        return store.add_record(
            MaintenanceRecord(
                record_id=uuid.uuid4().hex,
                vehicle_id=body.vehicle_id,
                completed_at=body.completed_at,
                completion_source=CompletionSource.MANUAL_ENTRY,
                notes=body.notes,
            )
        )

    @app.post("/sessions")
    def create_session(body: SessionIn) -> SessionUpdate:
        vehicle_or_404(body.vehicle_id)
        state = new_session(uuid.uuid4().hex, body.vehicle_id)
        store.save_session(state)
        return SessionUpdate(
            session=SessionView.of(state),
            transition_reason="session_started",
            spoken_hint=hint_text(STEP_ENTRY_HINT[Step.FIND_INLET]),
        )

    @app.get("/sessions/{session_id}")
    def get_session(session_id: str) -> SessionView:
        return SessionView.of(session_or_404(session_id))

    @app.post("/sessions/{session_id}/observations")
    async def post_observations(session_id: str, body: ObservationsIn) -> SessionUpdate:
        snapshot = session_or_404(session_id)
        _, spec = vehicle_or_404(snapshot.vehicle_id)
        reference = reference_frames.get(session_id)
        windows = sorted(body.windows, key=lambda w: w.sequence_id)
        decoded = [[base64.b64decode(f.jpeg_base64) for f in w.frames] for w in windows]

        async def analyze(frames: list[bytes]) -> SceneAnswer | None:
            try:
                return await asyncio.wait_for(
                    spark.analyze(frames, snapshot.step, reference), settings.spark_timeout_s
                )
            except Exception:  # noqa: BLE001 - 모델 실패는 대기로 처리한다
                return None

        answers = await asyncio.gather(*(analyze(frames) for frames in decoded))

        async with locks[session_id]:
            state = session_or_404(session_id)
            results: list[WindowResult] = []
            last_reason = "no_change"
            hint: str | None = None
            record: MaintenanceRecord | None = None
            for window, frames, answer in zip(windows, decoded, answers):
                if answer is None:
                    results.append(WindowResult(sequence_id=window.sequence_id, accepted=False, reason="model_error", answer=None))
                    last_reason = "model_error"
                    continue
                obs = Observation(
                    session_id=session_id,
                    sequence_id=window.sequence_id,
                    step=snapshot.step,
                    attempt=snapshot.attempt,
                    captured_at=window.frames[-1].captured_at,
                    frame_ids=[f.frame_id for f in window.frames],
                    answer=answer,
                    model_version=spark.model_version,
                )
                before = state.step
                result = transition(state, obs, now=utcnow(), spec=spec)
                state = result.state
                record = save_result(result) or record
                if state.step is not before:
                    reference_frames[session_id] = frames[-1]
                hint = result.spoken_hint or hint
                last_reason = result.reason
                results.append(
                    WindowResult(sequence_id=window.sequence_id, accepted=result.accepted, reason=result.reason, answer=answer)
                )
            # TODO: 전환 근거가 된 프레임만 Storage에 저장한다(연속 영상 전체는 저장하지 않음).
            return SessionUpdate(
                session=SessionView.of(state),
                transition_reason=last_reason,
                spoken_hint=hint,
                record=record,
                windows=results,
            )

    @app.post("/sessions/{session_id}/voice")
    async def post_voice(session_id: str, body: VoiceIn) -> SessionUpdate:
        async with locks[session_id]:
            state = session_or_404(session_id)
            result = apply_voice(state, body.intent, now=utcnow())
            record = save_result(result)
            if body.intent is VoiceIntent.RESTART:
                reference_frames.pop(session_id, None)
            return SessionUpdate(
                session=SessionView.of(result.state),
                transition_reason=result.reason,
                spoken_hint=result.spoken_hint,
                record=record,
            )

    @app.post("/voice/transcribe")
    async def transcribe(wav: bytes = Body(..., media_type="audio/wav")) -> dict:
        if not wav:
            raise HTTPException(422, "empty audio")
        try:
            text = await asyncio.wait_for(spark.transcribe(wav), settings.spark_timeout_s)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(502, f"transcribe failed: {type(exc).__name__}") from exc
        return {"text": text}

    @app.post("/briefings")
    async def briefing(body: BriefingIn) -> BriefingOut:
        vehicle, spec = vehicle_or_404(body.vehicle_id)
        records = store.list_records(vehicle.vehicle_id)
        weather = None
        if body.lat is not None and body.lon is not None:
            weather = await fetch_weather(body.lat, body.lon)
        now = utcnow()
        facts = build_facts(vehicle, spec, records, weather, now)
        text = render_briefing(facts, check_recommended=needs_check(records, now))
        return BriefingOut(text=text, facts=[f.model_dump(mode="json") for f in facts])

    @app.post("/assistant/ask")
    async def ask(body: AskIn) -> AskOut:
        vehicle, spec = vehicle_or_404(body.vehicle_id)
        records = store.list_records(vehicle.vehicle_id)
        now = utcnow()
        if is_memory_question(body.question):
            text, ids = render_memory_answer(records, now)
            return AskOut(text=text, fact_ids=ids)
        facts = build_facts(vehicle, spec, records, None, now)
        try:
            answer = await asyncio.wait_for(spark.answer(body.question, facts), settings.spark_timeout_s)
        except Exception:  # noqa: BLE001
            return AskOut(text="지금은 답을 가져오지 못했어요. 잠시 후 다시 물어봐 주세요.", fact_ids=[])
        known = {f.id for f in facts}
        if not answer.fact_ids or not set(answer.fact_ids) <= known:
            # 근거 사실을 대지 못한 답은 읽지 않는다.
            return AskOut(text="저장된 기록으로는 답하기 어려워요.", fact_ids=[])
        return AskOut(text=answer.text, fact_ids=answer.fact_ids)

    return app


app = create_app()
