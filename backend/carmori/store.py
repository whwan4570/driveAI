"""저장소 경계. 개발용 메모리 구현만 있다.

TODO(Day 1): supabase/schema.sql 기준의 Supabase 구현을 같은 메서드로 추가한다.
메모리 구현은 브라우저 새로고침에는 유지되지만 서버 재시작에는 사라진다.
"""

from __future__ import annotations

import uuid
from typing import Protocol

from .models import CompletionEvent, MaintenanceRecord, SessionState, VehicleProfile


class Store(Protocol):
    def save_vehicle(self, vehicle: VehicleProfile) -> None: ...
    def get_vehicle(self, vehicle_id: str) -> VehicleProfile | None: ...
    def save_session(self, state: SessionState) -> None: ...
    def get_session(self, session_id: str) -> SessionState | None: ...
    def add_record(self, record: MaintenanceRecord) -> MaintenanceRecord: ...
    def save_completion(
        self, event: CompletionEvent, model_version: str
    ) -> tuple[MaintenanceRecord, bool]: ...
    def list_records(self, vehicle_id: str) -> list[MaintenanceRecord]: ...


class MemoryStore:
    def __init__(self) -> None:
        self.vehicles: dict[str, VehicleProfile] = {}
        self.sessions: dict[str, SessionState] = {}
        self.records: dict[str, MaintenanceRecord] = {}
        self._by_completion: dict[str, str] = {}

    def save_vehicle(self, vehicle: VehicleProfile) -> None:
        self.vehicles[vehicle.vehicle_id] = vehicle

    def get_vehicle(self, vehicle_id: str) -> VehicleProfile | None:
        return self.vehicles.get(vehicle_id)

    def save_session(self, state: SessionState) -> None:
        self.sessions[state.session_id] = state

    def get_session(self, session_id: str) -> SessionState | None:
        return self.sessions.get(session_id)

    def add_record(self, record: MaintenanceRecord) -> MaintenanceRecord:
        self.records[record.record_id] = record
        return record

    def save_completion(
        self, event: CompletionEvent, model_version: str
    ) -> tuple[MaintenanceRecord, bool]:
        """completion_event_id가 같으면 기존 기록을 돌려준다(중복 저장 방지)."""
        existing = self._by_completion.get(event.completion_event_id)
        if existing is not None:
            return self.records[existing], False
        record = MaintenanceRecord(
            record_id=uuid.uuid4().hex,
            vehicle_id=event.vehicle_id,
            task=event.task,
            completed_at=event.completed_at,
            completion_source=event.completion_source,
            completion_event_id=event.completion_event_id,
            session_id=event.session_id,
            evidence_frames=event.evidence_frames,
            product_label=event.product_label,
            flow_observed=event.flow_observed,
            model_version=model_version,
        )
        self.records[record.record_id] = record
        self._by_completion[event.completion_event_id] = record.record_id
        return record, True

    def list_records(self, vehicle_id: str) -> list[MaintenanceRecord]:
        return sorted(
            (r for r in self.records.values() if r.vehicle_id == vehicle_id),
            key=lambda r: r.completed_at,
            reverse=True,
        )
