"""Vehicle, session, and maintenance persistence behind one store boundary."""

from __future__ import annotations

import uuid
import sqlite3
from pathlib import Path
from threading import RLock
from typing import Protocol

from .models import CompletionEvent, CompletionSource, MaintenanceRecord, SessionState, VehicleProfile


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
            user_confirmed=event.completion_source is CompletionSource.USER_VOICE_CONFIRMED,
            created_at=event.completed_at,
            updated_at=event.completed_at,
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


class SQLiteStore:
    """Single-user local MVP store. JSON columns preserve the validated Pydantic schema."""

    def __init__(self, path: str) -> None:
        db_path = Path(path).expanduser()
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(db_path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._lock = RLock()
        with self._lock:
            self._db.execute("PRAGMA journal_mode=WAL")
            self._db.executescript("""
                CREATE TABLE IF NOT EXISTS vehicles (
                    vehicle_id TEXT PRIMARY KEY, payload TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    session_id TEXT PRIMARY KEY, payload TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS records (
                    record_id TEXT PRIMARY KEY,
                    vehicle_id TEXT NOT NULL,
                    completed_at TEXT NOT NULL,
                    completion_event_id TEXT UNIQUE,
                    payload TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS records_vehicle_date
                    ON records(vehicle_id, completed_at DESC);
            """)

    def save_vehicle(self, vehicle: VehicleProfile) -> None:
        with self._lock, self._db:
            self._db.execute(
                "INSERT INTO vehicles(vehicle_id,payload) VALUES(?,?) "
                "ON CONFLICT(vehicle_id) DO UPDATE SET payload=excluded.payload",
                (vehicle.vehicle_id, vehicle.model_dump_json()),
            )

    def get_vehicle(self, vehicle_id: str) -> VehicleProfile | None:
        with self._lock:
            row = self._db.execute("SELECT payload FROM vehicles WHERE vehicle_id=?", (vehicle_id,)).fetchone()
        return VehicleProfile.model_validate_json(row["payload"]) if row else None

    def save_session(self, state: SessionState) -> None:
        with self._lock, self._db:
            self._db.execute(
                "INSERT INTO sessions(session_id,payload) VALUES(?,?) "
                "ON CONFLICT(session_id) DO UPDATE SET payload=excluded.payload",
                (state.session_id, state.model_dump_json()),
            )

    def get_session(self, session_id: str) -> SessionState | None:
        with self._lock:
            row = self._db.execute("SELECT payload FROM sessions WHERE session_id=?", (session_id,)).fetchone()
        return SessionState.model_validate_json(row["payload"]) if row else None

    def add_record(self, record: MaintenanceRecord) -> MaintenanceRecord:
        with self._lock, self._db:
            self._db.execute(
                "INSERT INTO records(record_id,vehicle_id,completed_at,completion_event_id,payload) VALUES(?,?,?,?,?) "
                "ON CONFLICT(record_id) DO UPDATE SET completed_at=excluded.completed_at,payload=excluded.payload",
                (record.record_id, record.vehicle_id, record.completed_at.isoformat(), record.completion_event_id, record.model_dump_json()),
            )
        return record

    def save_completion(self, event: CompletionEvent, model_version: str) -> tuple[MaintenanceRecord, bool]:
        with self._lock, self._db:
            row = self._db.execute(
                "SELECT payload FROM records WHERE completion_event_id=?", (event.completion_event_id,)
            ).fetchone()
            if row:
                return MaintenanceRecord.model_validate_json(row["payload"]), False
            record = MaintenanceRecord(
                record_id=uuid.uuid4().hex,
                vehicle_id=event.vehicle_id,
                task=event.task,
                component="washer_fluid",
                event_type="refill",
                completed_at=event.completed_at,
                completion_source=event.completion_source,
                completion_event_id=event.completion_event_id,
                session_id=event.session_id,
                evidence_frames=event.evidence_frames,
                product_label=event.product_label,
                flow_observed=event.flow_observed,
                model_version=model_version,
                user_confirmed=event.completion_source is CompletionSource.USER_VOICE_CONFIRMED,
                created_at=event.completed_at,
                updated_at=event.completed_at,
            )
            self._db.execute(
                "INSERT INTO records(record_id,vehicle_id,completed_at,completion_event_id,payload) VALUES(?,?,?,?,?)",
                (record.record_id, record.vehicle_id, record.completed_at.isoformat(), record.completion_event_id, record.model_dump_json()),
            )
            return record, True

    def list_records(self, vehicle_id: str) -> list[MaintenanceRecord]:
        with self._lock:
            rows = self._db.execute(
                "SELECT payload FROM records WHERE vehicle_id=? ORDER BY completed_at DESC", (vehicle_id,)
            ).fetchall()
        return [MaintenanceRecord.model_validate_json(row["payload"]) for row in rows]
