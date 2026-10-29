"""Verified owner-manual sources, matched to the exact vehicle variant."""

from __future__ import annotations

import re
from dataclasses import dataclass

from .models import VehicleProfile


@dataclass(frozen=True)
class OwnerManual:
    key: str
    title: str
    source_url: str
    filename: str


SONATA_2014 = OwnerManual(
    key="2014-hyundai-sonata-nonhybrid",
    title="2014 Hyundai Sonata Owner's Manual (non-hybrid)",
    source_url="https://dezosmanuals.com/wp-content/uploads/2021/07/2014-Hyundai-Sonata-OM.pdf",
    filename="2014-hyundai-sonata-owners-manual.pdf",
)

CIVIC_2021_SEDAN = OwnerManual(
    key="2021-honda-civic-sedan",
    title="2021 Honda Civic Sedan Owner's Manual",
    source_url="https://techinfo.honda.com/rjanisis/pubs/OM/AH/ATBA2121OM/enu/ATBA2121OM.pdf",
    filename="2021-honda-civic-sedan-owners-manual.pdf",
)


def match_owner_manual(vehicle: VehicleProfile) -> OwnerManual | None:
    make = (vehicle.make or "").strip().casefold()
    model = (vehicle.model or "").strip().casefold()
    trim = (vehicle.trim or "").strip().casefold()
    if (vehicle.year == 2014 and make == "hyundai" and re.match(r"^sonata(?:\s|$)", model)
            and "hybrid" not in f"{model} {trim}" and vehicle.body_style != "hatchback"):
        return SONATA_2014
    if (vehicle.year == 2021 and make == "honda" and re.match(r"^civic(?:\s|$)", model)
            and not re.search(r"hatch|coupe|type\s*r|\bsi\b", f"{model} {trim}")
            and (vehicle.body_style == "sedan" or "sedan" in model or vehicle.profile_source == "demo")):
        return CIVIC_2021_SEDAN
    return None
