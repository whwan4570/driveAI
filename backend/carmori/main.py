"""FastAPI 서버. 상태는 state_machine만 바꾸고, 여기서는 입출력과 저장만 한다.

실행: uvicorn carmori.main:app --reload
"""

from __future__ import annotations

import asyncio
import base64
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import Literal

import httpx
from fastapi import BackgroundTasks, Body, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .briefing import (
    build_facts,
    is_memory_question,
    render_briefing,
    render_memory_answer,
)
from .care import Recommendation, calculate_recommendations
from .config import Settings
from .hints import STEP_ENTRY_HINT, hint_text
from .inspection import InspectionResult, Inspector, MetaInspector, UnavailableInspector
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
from .spark import MetaSparkClient, SparkClient, make_spark_client
from .state_machine import TransitionResult, apply_voice, new_session, transition
from .store import MemoryStore, SQLiteStore, Store
from .vehicles import SUPPORTED_SPECS, VehicleSpec, get_spec
from .vehicle_recognition import DocumentMime, DocumentType, MetaVehicleRecognizer, ScanMode, VehicleRecognizer, VehicleScanResult, clean_name
from .vehicle_catalog import MAKES, POPULAR_MAKES, ModelCatalog, NhtsaModelCatalog
from .vehicle_image import MetaVehicleImageGenerator, VehicleImageError, VehicleImageGenerator
from .weather import EnvironmentProvider, OpenMeteoEnvironment, fetch_weather


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
    year: int = Field(ge=1981, le=2035)
    make: str | None = None
    model: str | None = None
    trim: str | None = None
    odometer_km: int | None = Field(default=None, ge=0)
    odometer_updated_at: datetime | None = None
    region: str | None = Field(default=None, max_length=120)
    weekly_miles: float | None = Field(default=None, ge=0, le=3000)
    highway_percent: int | None = Field(default=None, ge=0, le=100)
    nickname: str | None = Field(default=None, max_length=60)
    exterior_color: str | None = Field(default=None, max_length=40)
    profile_source: Literal["manual", "scan", "document", "demo"] = "manual"


class VehiclePatchIn(BaseModel):
    year: int | None = Field(default=None, ge=1981, le=2035)
    make: str | None = None
    model: str | None = None
    trim: str | None = None
    odometer_km: int | None = Field(default=None, ge=0)
    odometer_updated_at: datetime | None = None
    region: str | None = Field(default=None, max_length=120)
    weekly_miles: float | None = Field(default=None, ge=0, le=3000)
    highway_percent: int | None = Field(default=None, ge=0, le=100)
    nickname: str | None = Field(default=None, max_length=60)
    exterior_color: str | None = Field(default=None, max_length=40)


class VehicleScanIn(BaseModel):
    mode: ScanMode
    jpeg_base64: str = Field(min_length=100, max_length=5_600_000)


class DocumentScanIn(BaseModel):
    document_type: DocumentType
    mime_type: DocumentMime
    data_base64: str = Field(min_length=100, max_length=11_000_000)


class SessionIn(BaseModel):
    vehicle_id: str


class VoiceIn(BaseModel):
    intent: VoiceIntent
    # 화면 확인 버튼은 touch로 보내 기록 출처를 manual_entry로 남긴다.
    via: Literal["voice", "touch"] = "voice"


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
    component: Literal["washer_fluid", "tires"] = "washer_fluid"
    event_type: Literal["inspection", "refill", "rotation", "replacement"] = "refill"
    completed_at: datetime = Field(default_factory=utcnow)
    odometer_km: int | None = Field(default=None, ge=0)
    notes: str | None = Field(default=None, max_length=2000)
    user_confirmed: bool
    cost_usd: float | None = Field(default=None, ge=0)
    photo_data_url: str | None = Field(default=None, max_length=3_000_000)


class InspectionIn(BaseModel):
    component: Literal["washer_fluid", "tires"]
    photo_type: Literal["engine", "product", "tire"]
    jpeg_base64: str = Field(min_length=100, max_length=5_600_000)


def create_app(
    settings: Settings | None = None,
    spark: SparkClient | None = None,
    store: Store | None = None,
    recognizer: VehicleRecognizer | None = None,
    inspector: Inspector | None = None,
    image_generator: VehicleImageGenerator | None = None,
    environment_provider: EnvironmentProvider | None = None,
    model_catalog: ModelCatalog | None = None,
) -> FastAPI:
    settings = settings or Settings.from_env()
    spark = spark or make_spark_client(settings)
    store = store or (SQLiteStore(settings.db_path) if settings.db_path else MemoryStore())
    recognizer = recognizer or MetaVehicleRecognizer(settings)
    inspector = inspector or (MetaInspector(spark) if isinstance(spark, MetaSparkClient) else UnavailableInspector())
    image_generator = image_generator or MetaVehicleImageGenerator(settings)
    environment_provider = environment_provider or OpenMeteoEnvironment()
    model_catalog = model_catalog or NhtsaModelCatalog()
    locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
    reference_frames: dict[str, bytes] = {}
    model_access = {"status": "unverified" if settings.meta_api_key else "missing_key"}

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

    def image_identity(vehicle: VehicleProfile) -> tuple[int, str | None, str | None, str | None, str | None]:
        return (vehicle.year, vehicle.make, vehicle.model, vehicle.trim, vehicle.exterior_color)

    def can_generate(vehicle: VehicleProfile) -> bool:
        return bool(vehicle.make and vehicle.model and vehicle.exterior_color)

    async def generate_vehicle_image(vehicle_id: str, identity: tuple) -> None:
        async with locks[f"image:{vehicle_id}"]:
            current = store.get_vehicle(vehicle_id)
            if current is None or image_identity(current) != identity or not can_generate(current):
                return
            try:
                image = await image_generator.generate(current)
                changes = {"generated_image_data_url": image, "image_status": "ready", "image_error": None}
            except VehicleImageError as exc:
                changes = {"generated_image_data_url": None, "image_status": "failed", "image_error": exc.message}
            latest = store.get_vehicle(vehicle_id)
            if latest is not None and image_identity(latest) == identity:
                store.save_vehicle(latest.model_copy(update=changes))

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
        return {"ok": True, "spark": spark.model_version, "demo_mode": settings.spark_mode == "fake", "vision_status": model_access["status"]}

    @app.get("/vehicle-specs")
    def vehicle_specs() -> list[dict]:
        return [
            {"spec_id": s.spec_id, "display_name": s.display_name, "years": list(s.years)}
            for s in SUPPORTED_SPECS.values()
        ]

    @app.get("/vehicle-catalog/makes")
    def vehicle_makes() -> dict[str, list[str]]:
        return {"makes": list(MAKES), "popular": list(POPULAR_MAKES)}

    @app.get("/vehicle-catalog/models")
    async def vehicle_models(
        make: str = Query(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9][A-Za-z0-9 .&'-]*$"),
        year: int | None = Query(default=None, ge=1981, le=2035),
    ) -> dict:
        # 목록을 못 불러와도 직접 입력으로 계속 진행할 수 있게 실패를 상태로 돌려준다.
        try:
            models = await model_catalog.models(make.strip(), year)
        except (httpx.HTTPError, ValueError):
            return {"make": make, "year": year, "models": [], "status": "unavailable"}
        return {"make": make, "year": year, "models": models, "status": "available"}

    @app.get("/vehicles/recognition-status")
    def vehicle_recognition_status() -> dict[str, bool]:
        return {"available": bool(settings.meta_api_key)}

    @app.post("/vehicles/recognize", response_model=VehicleScanResult)
    async def recognize_vehicle(body: VehicleScanIn) -> VehicleScanResult:
        try:
            jpeg = base64.b64decode(body.jpeg_base64, validate=True)
        except (ValueError, base64.binascii.Error):
            raise HTTPException(422, "invalid image") from None
        if len(jpeg) > 4_000_000 or not (jpeg.startswith(b"\xff\xd8") and jpeg.endswith(b"\xff\xd9")):
            raise HTTPException(422, "expected a JPEG under 4 MB")
        result = await recognizer.recognize(jpeg, body.mode)
        if result.year and not any(s.years[0] <= result.year <= s.years[1] for s in SUPPORTED_SPECS.values()):
            return VehicleScanResult(status="unrecognized", source=body.mode, message="This prototype does not support that model year. Use a supported demo vehicle.")
        return result

    @app.post("/vehicles/recognize-document", response_model=VehicleScanResult)
    async def recognize_vehicle_document(body: DocumentScanIn) -> VehicleScanResult:
        try:
            data = base64.b64decode(body.data_base64, validate=True)
        except (ValueError, base64.binascii.Error):
            raise HTTPException(422, "invalid document") from None
        if len(data) > 8_000_000 or not {
            "application/pdf": lambda b: b.startswith(b"%PDF-"),
            "image/jpeg": lambda b: b.startswith(b"\xff\xd8") and b.endswith(b"\xff\xd9"),
            "image/png": lambda b: b.startswith(b"\x89PNG\r\n\x1a\n"),
        }[body.mime_type](data):
            raise HTTPException(422, "expected a PDF, JPEG, or PNG under 8 MB")
        result = await recognizer.recognize_document(data, body.mime_type, body.document_type)
        if result.year and not any(s.years[0] <= result.year <= s.years[1] for s in SUPPORTED_SPECS.values()):
            return VehicleScanResult(status="unrecognized", source="document", document_type=body.document_type, message="This prototype does not support that model year. Use a supported demo vehicle.")
        return result

    @app.post("/vehicles")
    def create_vehicle(body: VehicleIn, background_tasks: BackgroundTasks) -> VehicleProfile:
        spec = get_spec(body.spec_id)
        if spec is None or not spec.years[0] <= body.year <= spec.years[1]:
            raise HTTPException(422, "unsupported vehicle")
        vehicle = VehicleProfile(
            vehicle_id=uuid.uuid4().hex,
            spec_id=spec.spec_id,
            year=body.year,
            make=clean_name(body.make),
            model=clean_name(body.model),
            trim=clean_name(body.trim),
            odometer_km=body.odometer_km,
            odometer_updated_at=body.odometer_updated_at or (utcnow() if body.odometer_km is not None else None),
            region=clean_name(body.region),
            weekly_miles=body.weekly_miles,
            highway_percent=body.highway_percent,
            driving_updated_at=utcnow() if body.weekly_miles is not None or body.highway_percent is not None else None,
            nickname=clean_name(body.nickname),
            exterior_color=clean_name(body.exterior_color),
            image_status="pending" if body.make and body.model and body.exterior_color else "needs_color",
            profile_source=body.profile_source,
            created_at=utcnow(),
        )
        store.save_vehicle(vehicle)
        if can_generate(vehicle):
            background_tasks.add_task(generate_vehicle_image, vehicle.vehicle_id, image_identity(vehicle))
        return vehicle

    @app.get("/vehicles/{vehicle_id}")
    def get_vehicle(vehicle_id: str) -> VehicleProfile:
        return vehicle_or_404(vehicle_id)[0]

    @app.patch("/vehicles/{vehicle_id}")
    def update_vehicle(vehicle_id: str, body: VehiclePatchIn, background_tasks: BackgroundTasks) -> VehicleProfile:
        vehicle, spec = vehicle_or_404(vehicle_id)
        changes = body.model_dump(exclude_unset=True)
        if "year" in changes and (changes["year"] is None or not spec.years[0] <= changes["year"] <= spec.years[1]):
            raise HTTPException(422, "unsupported vehicle year")
        for field in ("make", "model", "trim", "region", "nickname", "exterior_color"):
            if field in changes:
                changes[field] = clean_name(changes[field])
        if "odometer_km" in changes and "odometer_updated_at" not in changes:
            changes["odometer_updated_at"] = utcnow()
        if "weekly_miles" in changes or "highway_percent" in changes:
            changes["driving_updated_at"] = utcnow()
        updated = vehicle.model_copy(update=changes)
        if image_identity(updated) != image_identity(vehicle):
            updated = updated.model_copy(update={"generated_image_data_url": None,
                "image_status": "pending" if can_generate(updated) else "needs_color", "image_error": None})
        store.save_vehicle(updated)
        if updated.image_status == "pending" and image_identity(updated) != image_identity(vehicle):
            background_tasks.add_task(generate_vehicle_image, vehicle_id, image_identity(updated))
        return updated

    @app.post("/vehicles/{vehicle_id}/generate-image")
    async def retry_vehicle_image(vehicle_id: str) -> VehicleProfile:
        vehicle, _ = vehicle_or_404(vehicle_id)
        if not can_generate(vehicle):
            raise HTTPException(422, "confirm the vehicle make, model, and exterior color first")
        pending = vehicle.model_copy(update={"image_status": "pending", "image_error": None})
        store.save_vehicle(pending)
        await generate_vehicle_image(vehicle_id, image_identity(pending))
        return vehicle_or_404(vehicle_id)[0]

    @app.get("/vehicles/{vehicle_id}/care-recommendations")
    async def care_recommendations(vehicle_id: str) -> dict:
        vehicle, _ = vehicle_or_404(vehicle_id)
        now = utcnow()
        environment = await environment_provider.get(vehicle.region)
        recommendations: list[Recommendation] = calculate_recommendations(vehicle, store.list_records(vehicle_id), now, environment)
        return {
            "recommendations": [item.model_dump(mode="json") for item in recommendations],
            "environment": environment.model_dump(mode="json"),
            "calculated_at": now.isoformat(),
        }

    @app.get("/vehicles/{vehicle_id}/memory")
    @app.get("/vehicles/{vehicle_id}/maintenance-records")
    def vehicle_memory(vehicle_id: str) -> list[MaintenanceRecord]:
        vehicle_or_404(vehicle_id)
        return store.list_records(vehicle_id)

    @app.post("/maintenance-records")
    def create_manual_record(body: ManualRecordIn) -> MaintenanceRecord:
        vehicle_or_404(body.vehicle_id)
        if not body.user_confirmed:
            raise HTTPException(422, "completed maintenance requires user confirmation")
        if (body.component == "washer_fluid" and body.event_type not in ("inspection", "refill")) or (
            body.component == "tires" and body.event_type == "refill"
        ):
            raise HTTPException(422, "event type does not match component")
        if body.photo_data_url:
            prefix = "data:image/jpeg;base64,"
            if not body.photo_data_url.startswith(prefix):
                raise HTTPException(422, "expected a JPEG photo")
            try:
                photo = base64.b64decode(body.photo_data_url[len(prefix):], validate=True)
            except (ValueError, base64.binascii.Error):
                raise HTTPException(422, "invalid photo") from None
            if len(photo) > 2_000_000 or not (photo.startswith(b"\xff\xd8") and photo.endswith(b"\xff\xd9")):
                raise HTTPException(422, "expected a JPEG under 2 MB")
        now = utcnow()
        return store.add_record(
            MaintenanceRecord(
                record_id=uuid.uuid4().hex,
                vehicle_id=body.vehicle_id,
                task=f"{body.component}_{body.event_type}",
                component=body.component,
                event_type=body.event_type,
                completed_at=body.completed_at,
                completion_source=CompletionSource.MANUAL_ENTRY,
                notes=body.notes,
                odometer_km=body.odometer_km,
                user_confirmed=True,
                cost_usd=body.cost_usd,
                photo_data_url=body.photo_data_url,
                created_at=now,
                updated_at=now,
            )
        )

    @app.post("/vehicles/{vehicle_id}/inspections/analyze", response_model=InspectionResult)
    async def analyze_inspection(vehicle_id: str, body: InspectionIn) -> InspectionResult:
        vehicle_or_404(vehicle_id)
        if (body.component == "washer_fluid" and body.photo_type == "tire") or (body.component == "tires" and body.photo_type != "tire"):
            raise HTTPException(422, "photo type does not match component")
        try:
            jpeg = base64.b64decode(body.jpeg_base64, validate=True)
        except (ValueError, base64.binascii.Error):
            raise HTTPException(422, "invalid image") from None
        if len(jpeg) > 4_000_000 or not (jpeg.startswith(b"\xff\xd8") and jpeg.endswith(b"\xff\xd9")):
            raise HTTPException(422, "expected a JPEG under 4 MB")
        try:
            result = await asyncio.wait_for(inspector.analyze(jpeg, body.component, body.photo_type), settings.spark_timeout_s)
            if result.source == "meta_vision":
                model_access["status"] = "ready"
            return result
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            model_access["status"] = "billing_required" if status == 402 else "unauthorized" if status in (401, 403) else "provider_error"
            message = "Meta image analysis is blocked because billing is not configured for this API key." if status == 402 else "Meta rejected this API key or model permission." if status in (401, 403) else "Image analysis is temporarily unavailable. Retry or consult your vehicle manual."
            return InspectionResult(status="unavailable", component=body.component, observation=message)
        except Exception:  # noqa: BLE001 - provider failures are explicit to the client
            return InspectionResult(status="unavailable", component=body.component, observation="Image analysis is temporarily unavailable. Retry or consult your vehicle manual.")

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
                answer = await asyncio.wait_for(
                    spark.analyze(frames, snapshot.step, reference), settings.spark_timeout_s
                )
                model_access["status"] = "ready"
                return answer
            except httpx.HTTPStatusError as exc:
                status = exc.response.status_code
                model_access["status"] = "billing_required" if status == 402 else "unauthorized" if status in (401, 403) else "provider_error"
                return None
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
                    reason = "model_billing_required" if model_access["status"] == "billing_required" else "model_unauthorized" if model_access["status"] == "unauthorized" else "model_error"
                    results.append(WindowResult(sequence_id=window.sequence_id, accepted=False, reason=reason, answer=None))
                    last_reason = reason
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
            result = apply_voice(state, body.intent, now=utcnow(), via=body.via)
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
        environment = await environment_provider.get(vehicle.region)
        text = render_briefing(facts, recommendations=calculate_recommendations(vehicle, records, now, environment))
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
            return AskOut(text="I cannot get an answer right now. Please ask again shortly.", fact_ids=[])
        known = {f.id for f in facts}
        if not answer.fact_ids or not set(answer.fact_ids) <= known:
            # 근거 사실을 대지 못한 답은 읽지 않는다.
            return AskOut(text="I cannot answer that from your saved records.", fact_ids=[])
        return AskOut(text=answer.text, fact_ids=answer.fact_ids)

    return app


app = create_app()
