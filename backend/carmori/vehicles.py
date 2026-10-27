"""Generic washer guidance; no manufacturer service interval is claimed."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class VehicleSpec:
    spec_id: str
    display_name: str
    years: tuple[int, int]
    inlet_description: str
    manual_ref: str
    # 라벨에 이 단어가 있고 Spark가 워셔액으로 분류하면 MATCH.
    washer_label_terms: tuple[str, ...]
    # 라벨에 이 단어가 있으면 CONFLICT.
    forbidden_label_terms: tuple[str, ...]


DEMO_SPEC = VehicleSpec(
    spec_id="demo",
    display_name="Generic vehicle guide",
    years=(1981, 2035),
    inlet_description="Blue cap with a windshield washer symbol in the engine bay",
    manual_ref="Vehicle-specific manual unavailable; confirm the reservoir in your owner's manual",
    washer_label_terms=("워셔액", "washer", "windshield", "윈도우액"),
    forbidden_label_terms=("냉각수", "coolant", "엔진오일", "engineoil", "브레이크", "brake"),
)

SUPPORTED_SPECS: dict[str, VehicleSpec] = {DEMO_SPEC.spec_id: DEMO_SPEC}


def get_spec(spec_id: str) -> VehicleSpec | None:
    return SUPPORTED_SPECS.get(spec_id)
