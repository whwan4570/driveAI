"""Deterministic, evidence-backed MVP care suggestions for two components.

These are contextual inspection suggestions, not manufacturer service intervals or
predictions of component failure. AI may explain them but cannot change priority.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from .models import MaintenanceRecord, VehicleProfile
from .weather import EnvironmentContext


Priority = Literal["CHECK_SOON", "ROUTINE", "INFORMATION_NEEDED"]
Component = Literal["washer_fluid", "tires"]


class Evidence(BaseModel):
    label: str
    value: str
    source: Literal["vehicle_profile", "maintenance_record", "user_driving_profile", "external_weather"]
    record_id: str | None = None


class Recommendation(BaseModel):
    id: str
    component: Component
    priority: Priority
    title: str
    explanation: str
    evidence: list[Evidence]
    unknown: list[str]
    suggested_action: Literal["washer_guide", "tire_check"]
    last_recorded_at: datetime | None
    calculated_at: datetime
    source: Literal["contextual_inspection_rule"] = "contextual_inspection_rule"
    manufacturer_guidance_status: Literal["unavailable"] = "unavailable"


def _latest(records: list[MaintenanceRecord], component: Component) -> MaintenanceRecord | None:
    relevant = [record for record in records if record.component == component and record.confirmed]
    return max(relevant, key=lambda record: record.completed_at, default=None)


def calculate_recommendations(
    vehicle: VehicleProfile, records: list[MaintenanceRecord], now: datetime,
    environment: EnvironmentContext | None = None,
) -> list[Recommendation]:
    odo = Evidence(
        label="Odometer",
        value=f"{vehicle.odometer_km / 1.609344:,.0f} mi" if vehicle.odometer_km is not None else "Not provided",
        source="vehicle_profile",
    )
    weekly = Evidence(
        label="Typical weekly driving",
        value=f"{vehicle.weekly_miles:,.0f} mi/week" if vehicle.weekly_miles is not None else "Not provided",
        source="user_driving_profile",
    )

    washer = _latest(records, "washer_fluid")
    recent_rain = environment.rainfall_mm if environment and environment.status == "available" else None
    if washer and washer.event_type == "refill":
        washer_priority: Priority = "ROUTINE"
        washer_title = "Washer refill is recorded"
        washer_explanation = "A completed refill is in your history. Check the level directly when visibility or washer performance changes."
    elif washer:
        washer_priority = "ROUTINE"
        washer_title = "Washer inspection is recorded"
        washer_explanation = "An inspection is in your history. Carmori still cannot measure the current fluid level."
    elif recent_rain is not None and recent_rain >= 10:
        washer_priority = "CHECK_SOON"
        washer_title = "Check the washer fluid level soon"
        washer_explanation = "Your area had at least 10 mm of rain in the past week and no confirmed washer check is saved. Rain can increase washer use; the actual fluid level is still unknown."
    else:
        washer_priority = "INFORMATION_NEEDED"
        washer_title = "Check the washer fluid level"
        washer_explanation = "No confirmed washer inspection or refill is saved, so the current level is unknown."
    washer_evidence = [odo]
    if recent_rain is not None:
        washer_evidence.append(Evidence(label="Recent area rainfall", value=f"{recent_rain:.1f} mm over 7 days", source="external_weather"))
    if washer:
        washer_evidence.append(Evidence(
            label="Last confirmed washer action", value=f"{washer.event_type} on {washer.completed_at.date().isoformat()}",
            source="maintenance_record", record_id=washer.record_id,
        ))
    recommendations = [Recommendation(
        id="washer_fluid", component="washer_fluid", priority=washer_priority,
        title=washer_title, explanation=washer_explanation, evidence=washer_evidence,
        unknown=["Current fluid level", "Manufacturer-specific washer guidance"],
        suggested_action="washer_guide", last_recorded_at=washer.completed_at if washer else None,
        calculated_at=now,
    )]

    tire = _latest(records, "tires")
    if tire:
        tire_priority: Priority = "ROUTINE"
        tire_title = "Tire check is on record"
        tire_explanation = "A tire action was confirmed. Check again if you notice pressure loss, damage, or unusual handling."
    elif vehicle.weekly_miles is None:
        tire_priority = "INFORMATION_NEEDED"
        tire_title = "Add driving distance for tire care"
        tire_explanation = "Carmori needs your typical weekly mileage and an inspection record to tailor a tire check."
    elif vehicle.weekly_miles >= 200:
        tire_priority = "CHECK_SOON"
        tire_title = "Inspect your tires soon"
        tire_explanation = "Your declared weekly distance is 200 miles or more and no confirmed tire inspection is recorded. This is a contextual check, not a replacement prediction."
    else:
        tire_priority = "INFORMATION_NEEDED"
        tire_title = "Record a tire inspection"
        tire_explanation = "No confirmed tire inspection is recorded. A visual check or gauge reading would improve this recommendation."
    tire_evidence = [weekly, odo]
    if tire:
        tire_evidence.append(Evidence(
            label="Last confirmed tire action", value=f"{tire.event_type} on {tire.completed_at.date().isoformat()}",
            source="maintenance_record", record_id=tire.record_id,
        ))
    recommendations.append(Recommendation(
        id="tires", component="tires", priority=tire_priority,
        title=tire_title, explanation=tire_explanation, evidence=tire_evidence,
        unknown=["Current tire pressure", "Measured tread depth", "Manufacturer-specific tire guidance"],
        suggested_action="tire_check", last_recorded_at=tire.completed_at if tire else None,
        calculated_at=now,
    ))
    order = {"CHECK_SOON": 0, "INFORMATION_NEEDED": 1, "ROUTINE": 2}
    return sorted(recommendations, key=lambda item: order[item.priority])
