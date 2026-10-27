"""브리핑과 기억 답변. 사실은 템플릿으로 만들고, 없는 상태는 만들지 않는다."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime

from pydantic import BaseModel

from .models import CompletionSource, MaintenanceRecord, VehicleProfile
from .vehicles import VehicleSpec
from .weather import WeatherNow

# TODO(Day 1): 매뉴얼·사용 패턴을 근거로 확정한다. 지금 값은 자리표시다.
REFILL_CHECK_DAYS = 30

SOURCE_LABEL: dict[CompletionSource, str] = {
    CompletionSource.OBSERVED_SEQUENCE: "카메라로 관찰한 작업",
    CompletionSource.USER_VOICE_CONFIRMED: "음성으로 확인한 작업",
    CompletionSource.MANUAL_ENTRY: "직접 입력한 기록",
}


class Fact(BaseModel):
    id: str
    text: str
    source: str
    as_of: datetime | None = None


def latest_refill(records: Sequence[MaintenanceRecord]) -> MaintenanceRecord | None:
    refills = [r for r in records if r.task == "washer_fluid_refill"]
    return max(refills, key=lambda r: r.completed_at, default=None)


def build_facts(
    vehicle: VehicleProfile,
    spec: VehicleSpec,
    records: Sequence[MaintenanceRecord],
    weather: WeatherNow | None,
    now: datetime,
) -> list[Fact]:
    facts = [
        Fact(id="vehicle", text=f"{spec.display_name} {vehicle.year}년식", source="profile", as_of=vehicle.created_at)
    ]
    last = latest_refill(records)
    if last is None:
        facts.append(Fact(id="last_refill", text="워셔액 보충 기록이 없어요.", source="records"))
    else:
        days = (now - last.completed_at).days
        when = "오늘" if days == 0 else f"{days}일 전"
        facts.append(
            Fact(
                id="last_refill",
                text=f"마지막 워셔액 보충은 {when}이고, {SOURCE_LABEL[last.completion_source]}이에요.",
                source="records",
                as_of=last.completed_at,
            )
        )
    facts.append(
        Fact(id="level_unknown", text="남은 워셔액 양은 확인한 적이 없어요.", source="system")
    )
    if weather is not None:
        facts.append(
            Fact(
                id="weather",
                text=f"지금 기온은 {weather.temperature_c:.0f}도, 강수량은 {weather.precipitation_mm:.1f}밀리미터예요.",
                source="Open-Meteo",
                as_of=weather.observed_at,
            )
        )
    return facts


def needs_check(records: Sequence[MaintenanceRecord], now: datetime) -> bool:
    last = latest_refill(records)
    return last is None or (now - last.completed_at).days >= REFILL_CHECK_DAYS


def render_briefing(facts: Sequence[Fact], *, check_recommended: bool) -> str:
    parts = [f.text for f in facts if f.id != "vehicle"]
    if check_recommended:
        parts.append("출발 전에 워셔액을 한 번 확인해 보세요.")
    return " ".join(parts)


def is_memory_question(text: str) -> bool:
    return any(k in text for k in ("아까", "뭐 했", "뭘 했", "언제 넣", "기록 알려"))


def render_memory_answer(records: Sequence[MaintenanceRecord], now: datetime) -> tuple[str, list[str]]:
    last = latest_refill(records)
    if last is None:
        return "아직 저장된 워셔액 보충 기록이 없어요.", []
    days = (now - last.completed_at).days
    when = f"오늘 {last.completed_at:%H시 %M분}" if days == 0 else f"{days}일 전"
    text = (
        f"{when}에 워셔액 보충을 기록했어요. {SOURCE_LABEL[last.completion_source]}이에요. "
        "넣은 양과 남은 양은 확인하지 않았어요."
    )
    return text, [last.record_id]
