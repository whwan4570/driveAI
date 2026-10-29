"""Small, verified owner-manual answers. Expand by exact year/model/body/trim."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from .manual_catalog import CIVIC_2021_SEDAN, SONATA_2014
from .models import MaintenanceRecord, VehicleProfile


@dataclass(frozen=True)
class ManualGuidance:
    text: str
    source_label: str
    source_url: str
    direct: bool = False


CIVIC_2021_SEDAN_MANUAL = CIVIC_2021_SEDAN.source_url
SONATA_2014_MANUAL = SONATA_2014.source_url


def find_manual_guidance(vehicle: VehicleProfile, question: str,
                         records: Sequence[MaintenanceRecord] = ()) -> ManualGuidance | None:
    """Return guidance only for a known topic; never infer unknown equipment."""
    name = f"{vehicle.model or ''} {vehicle.trim or ''}".casefold()
    query = question.casefold()
    if (vehicle.year == 2014 and (vehicle.make or "").casefold() == "hyundai"
            and (vehicle.model or "").casefold().strip().startswith("sonata") and "hybrid" not in name
            and ("brake" in query or "break" in query) and "pad" in query and "fluid" not in query):
        last = max((record for record in records if record.component == "brake_pads" and record.confirmed),
                   key=lambda record: record.completed_at, default=None)
        history = (f"The last saved brake-pad {last.event_type} was {last.completed_at.date().isoformat()}. "
                   if last else "No recent brake-pad inspection is saved, so arrange an inspection now. ")
        return ManualGuidance(
            text=("For a non-hybrid 2014 Sonata, Hyundai's normal schedule calls for front and rear brake-pad "
                  "inspection at 15,000 miles or 12 months and at subsequent scheduled intervals; severe use "
                  "calls for more frequent checks. " + history + "Odometer mileage alone cannot show remaining "
                  "pad thickness. The manual gives no fixed pad-replacement mileage: replace pads based on "
                  "measured wear. A persistent high-pitched brake-wear sound needs prompt service."),
            source_label="Hyundai 2014 Sonata Owner’s Manual · Maintenance (archived PDF)",
            source_url=SONATA_2014_MANUAL,
            direct=True,
        )
    if not (vehicle.year == 2021 and (vehicle.make or "").casefold() == "honda" and "civic" in name):
        return None
    if vehicle.body_style == "hatchback" or any(variant in name for variant in ("hatch", "type r", "coupe", "si")):
        return None
    sedan_confirmed = vehicle.body_style == "sedan" or "sedan" in name or vehicle.profile_source == "demo"
    if ("brake" in query or "break" in query) and "pad" in query and "fluid" not in query:
        last = max((record for record in records if record.component == "brake_pads" and record.confirmed),
                   key=lambda record: record.completed_at, default=None)
        profile = []
        if vehicle.odometer_km is not None:
            profile.append(f"{vehicle.odometer_km / 1.609344:,.0f} mi")
        if vehicle.weekly_miles is not None:
            profile.append(f"{vehicle.weekly_miles:,.0f} mi/week")
        if vehicle.highway_percent is not None:
            profile.append(f"{vehicle.highway_percent}% highway driving")
        opening = f"With {' and '.join(profile)}, " if profile else ""
        if last is None:
            history = "I have no brake inspection on record, so I recommend having the pads checked now."
        elif last.event_type == "replacement":
            history = f"Your last recorded pad replacement was {last.completed_at.date().isoformat()}."
        else:
            history = f"Your last recorded brake inspection was {last.completed_at.date().isoformat()}."
        return ManualGuidance(
            text=(opening + "mileage and driving mix cannot tell us the remaining pad thickness. "
                  + history + " Honda's Maintenance Minder B service includes front and rear brake inspection. "
                  "Replace pads based on an inspection, rather than an assumed mileage. "
                  "If braking makes a screeching sound, have the car inspected promptly. "
                  + ("" if sedan_confirmed else "This is the 2021 Civic Sedan manual; confirm your body style.")),
            source_label="Honda 2021 Civic Sedan Owner’s Manual · Maintenance Minder B",
            source_url=CIVIC_2021_SEDAN_MANUAL + "#page=520",
            direct=True,
        )
    if any(word in query for word in ("rear", "back seat", "third row")):
        return None
    if not ("passenger" in query and "seat" in query and any(word in query for word in ("move", "adjust", "slide", "forward", "backward", "baward"))):
        return None

    trim = (vehicle.trim or "").casefold().strip()
    if trim == "touring":
        control = "The Touring sedan has a powered front passenger seat; use its horizontal adjustment switch to slide it."
    elif trim in {"lx", "sport", "ex", "ex-l"}:
        control = "Pull up the bar below the front of the passenger seat, slide the seat, then release the bar and rock the seat to check that it locked."
    else:
        control = "On a manual seat, pull up the bar below its front edge, slide the seat, then release and check that it locked. The Touring sedan instead has a powered passenger seat with a horizontal adjustment switch."
    prefix = "For your 2021 Civic Sedan, " if sedan_confirmed else "For a 2021 Civic Sedan, "
    suffix = " Confirm the body style and trim for the exact control." if not sedan_confirmed or not trim else ""
    return ManualGuidance(
        text=prefix + control[0].lower() + control[1:] + " Adjust the seat before driving." + suffix,
        source_label="Honda 2021 Civic Sedan Owner’s Manual",
        source_url=CIVIC_2021_SEDAN_MANUAL,
    )
