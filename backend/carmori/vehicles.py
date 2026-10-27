"""지원 차량 사양. MVP는 차량 1종만 지원한다."""

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


# TODO(Day 1): 실제 시연 차량·연식·매뉴얼 항목으로 교체한다.
DEMO_SPEC = VehicleSpec(
    spec_id="demo",
    display_name="시연 차량 (Day 1 확정)",
    years=(2015, 2026),
    inlet_description="엔진룸 안 와이퍼·물줄기 기호가 있는 파란 캡",
    manual_ref="TBD: 차량 매뉴얼의 워셔액 항목 페이지",
    washer_label_terms=("워셔액", "washer", "windshield", "윈도우액"),
    forbidden_label_terms=("냉각수", "coolant", "엔진오일", "engineoil", "브레이크", "brake"),
)

SUPPORTED_SPECS: dict[str, VehicleSpec] = {DEMO_SPEC.spec_id: DEMO_SPEC}


def get_spec(spec_id: str) -> VehicleSpec | None:
    return SUPPORTED_SPECS.get(spec_id)
