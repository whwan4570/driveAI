"""브리핑과 기억 답변. 사실은 템플릿으로 만들고, 없는 상태는 만들지 않는다."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime

from pydantic import BaseModel

from .care import Recommendation
from .models import CompletionSource, MaintenanceRecord, VehicleProfile
from .vehicles import VehicleSpec
from .weather import WeatherNow

SOURCE_LABEL: dict[CompletionSource, str] = {
    CompletionSource.OBSERVED_SEQUENCE: "observed by camera",
    CompletionSource.USER_VOICE_CONFIRMED: "confirmed by voice",
    CompletionSource.MANUAL_ENTRY: "added manually",
}

def source_label(record: MaintenanceRecord) -> str:
    return "simulated observation" if record.model_version == "fake-happy-path" else SOURCE_LABEL[record.completion_source]


class Fact(BaseModel):
    id: str
    text: str
    source: str
    as_of: datetime | None = None


def latest_refill(records: Sequence[MaintenanceRecord]) -> MaintenanceRecord | None:
    refills = [r for r in records if r.component == "washer_fluid" and r.event_type == "refill" and r.confirmed]
    return max(refills, key=lambda r: r.completed_at, default=None)


def build_facts(
    vehicle: VehicleProfile,
    spec: VehicleSpec,
    records: Sequence[MaintenanceRecord],
    weather: WeatherNow | None,
    now: datetime,
) -> list[Fact]:
    vehicle_name = f"{vehicle.year} {vehicle.make} {vehicle.model}" if vehicle.make and vehicle.model else f"{vehicle.year} {spec.display_name}"
    facts = [Fact(id="vehicle", text=vehicle_name, source="profile", as_of=vehicle.created_at)]
    if vehicle.odometer_km is not None:
        facts.append(Fact(id="odometer", text=f"The saved odometer is {vehicle.odometer_km / 1.609344:,.0f} miles.", source="profile", as_of=vehicle.odometer_updated_at))
    if vehicle.weekly_miles is not None:
        highway = f" and an estimated {vehicle.highway_percent}% highway share" if vehicle.highway_percent is not None else ""
        if vehicle.driving_source == "gps":
            text = f"Phone GPS tracked {vehicle.weekly_miles:,.0f} miles in the past 7 days{highway}."
            source = "phone_gps"
        else:
            text = f"The driver entered {vehicle.weekly_miles:,.0f} typical miles per week{highway}."
            source = "user_driving_profile"
        facts.append(Fact(id="driving_profile", text=text, source=source, as_of=vehicle.driving_updated_at))
    last = latest_refill(records)
    if last is None:
        facts.append(Fact(id="last_refill", text="There is no washer fluid refill on record.", source="records"))
    else:
        days = (now - last.completed_at).days
        when = "today" if days == 0 else f"{days} {'day' if days == 1 else 'days'} ago"
        facts.append(
            Fact(
                id="last_refill",
                text=f"The last washer fluid refill was logged {when}, {source_label(last)}.",
                source="records",
                as_of=last.completed_at,
            )
        )
    facts.append(
        Fact(id="level_unknown", text="I have not checked the actual washer fluid level.", source="system")
    )
    tires = [record for record in records if record.component == "tires" and record.confirmed]
    tire = max(tires, key=lambda record: record.completed_at, default=None)
    facts.append(Fact(id="tire_history", text=f"The last confirmed tire action was {tire.event_type} on {tire.completed_at.date().isoformat()}." if tire else "There is no confirmed tire inspection on record.", source="records", as_of=tire.completed_at if tire else None))
    if spec.manual_notes:
        facts.extend(
            Fact(id=note.id, text=f"{note.text} (owner's manual p. {note.page})", source="owner_manual")
            for note in spec.manual_notes
        )
    else:
        facts.append(Fact(id="manufacturer_guidance", text="Carmori has no verified owner-manual excerpt for this question.", source="system"))
    if weather is not None:
        facts.append(
            Fact(
                id="weather",
                text=f"The current temperature is {weather.temperature_c:.0f} degrees Celsius, with {weather.precipitation_mm:.1f} millimeters of precipitation.",
                source="Open-Meteo",
                as_of=weather.observed_at,
            )
        )
    return facts


def render_briefing(facts: Sequence[Fact], *, recommendations: Sequence[Recommendation]) -> str:
    parts = [f.text for f in facts if f.id in {"last_refill", "level_unknown", "manual_washer_check", "weather"}]
    for recommendation in recommendations:
        if recommendation.priority != "ROUTINE":
            parts.append(recommendation.explanation)
    return " ".join(parts)


def is_memory_question(text: str) -> bool:
    question = text.casefold()
    return any(
        phrase in question
        for phrase in (
            "what did i do",
            "what did we do",
            "what happened earlier",
            "what did i just do",
            "what did we just do",
            "when did i refill",
            "when did we refill",
            "last refill",
            "last tire inspection",
            "when did i inspect",
            "what maintenance",
            "maintenance history",
        )
    )


def render_memory_answer(records: Sequence[MaintenanceRecord], now: datetime) -> tuple[str, list[str]]:
    last = max((record for record in records if record.confirmed), key=lambda record: record.completed_at, default=None)
    if last is None:
        return "There is no confirmed maintenance on record yet.", []
    when = last.completed_at.strftime("%b %d, %Y at %H:%M UTC")
    component = {
        "tires": "tire", "washer_fluid": "washer fluid", "engine_oil": "engine oil",
        "brake_pads": "brake pad", "cabin_filter": "cabin air filter",
        "engine_air_filter": "engine air filter",
    }.get(last.component, last.component.replace("_", " "))
    text = (
        f"A {component} {last.event_type} was logged on {when}, {source_label(last)}. "
        + (f"The confirmed product was {last.product_label}. " if last.product_label else "")
        + (f"Your note says: {last.notes}. " if last.notes else "")
        + ("The amount poured and remaining fluid level were not verified." if last.component == "washer_fluid" and last.event_type == "refill" else "")
    )
    return text, [last.record_id]
