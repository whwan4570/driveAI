"""Washer guidance per vehicle. Only the demo Sonata cites its owner's manual; no service interval is claimed."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ManualNote:
    """One statement taken from the owner's manual, with its printed page."""

    id: str
    text: str
    page: str


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
    # 차량 전용 가이드는 연식·제조사·모델이 모두 맞을 때만 고른다. None이면 범용 가이드.
    make: str | None = None
    model: str | None = None
    manual_notes: tuple[ManualNote, ...] = ()


WASHER_LABEL_TERMS = ("워셔액", "washer", "windshield", "윈도우액")
FORBIDDEN_LABEL_TERMS = ("냉각수", "coolant", "엔진오일", "engineoil", "브레이크", "brake")

DEMO_SPEC = VehicleSpec(
    spec_id="demo",
    display_name="Generic vehicle guide",
    years=(1981, 2035),
    inlet_description="Blue cap with a windshield washer symbol in the engine bay",
    manual_ref="Vehicle-specific manual unavailable; confirm the reservoir in your owner's manual",
    washer_label_terms=WASHER_LABEL_TERMS,
    forbidden_label_terms=FORBIDDEN_LABEL_TERMS,
)

# 2014 Hyundai Sonata (YF, US), base GLS 2.4 GDI. Pages are the printed page numbers of the
# 2014 Sonata Owner's Manual (US edition). The manual does not list a washer reservoir capacity
# or a cap color, so neither is stated here.
SONATA_2014_SPEC = VehicleSpec(
    spec_id="hyundai_sonata_2014",
    display_name="2014 Hyundai Sonata",
    years=(2014, 2014),
    inlet_description=(
        "Washer reservoir filler neck at the front of the engine compartment on the passenger side, "
        "beside the engine coolant reservoir. Round flip-up cap with the windshield washer symbol."
    ),
    manual_ref="2014 Hyundai Sonata Owner's Manual (US), pages 4-74, 4-82, 7-2, 7-5, 7-27 and 8-3",
    washer_label_terms=WASHER_LABEL_TERMS,
    forbidden_label_terms=FORBIDDEN_LABEL_TERMS,
    make="Hyundai",
    model="Sonata",
    manual_notes=(
        ManualNote(
            id="manual_washer_location",
            text="The 2014 Sonata owner's manual places the washer reservoir filler neck at the front of the engine compartment on the passenger side.",
            page="4-82",
        ),
        ManualNote(
            id="manual_washer_check",
            text="The owner's manual says to check the windshield washer fluid level when you stop for fuel.",
            page="7-5",
        ),
        ManualNote(
            id="manual_washer_level",
            text="The washer reservoir is translucent, so the manual says the level can be checked by looking at it.",
            page="7-27",
        ),
        ManualNote(
            id="manual_washer_fluid_type",
            text="The manual allows plain water when washer fluid is unavailable, but recommends washer solvent with antifreeze in cold climates.",
            page="7-27",
        ),
        ManualNote(
            id="manual_no_coolant",
            text="The manual warns never to put radiator coolant or antifreeze in the washer reservoir; the coolant reservoir sits right next to it.",
            page="7-27",
        ),
        ManualNote(
            id="manual_low_washer_light",
            text="The low washer fluid warning light means the reservoir is near empty.",
            page="4-74",
        ),
        ManualNote(
            id="manual_tire_pressure",
            text="The manual lists 34 psi front and rear for the P205/65R16 and P215/55R17 tires; check the size on your tire label.",
            page="8-3",
        ),
    ),
)

# 범용 가이드를 먼저 둔다. 등록 화면은 첫 항목을 고르고, 서버가 차량 전용 가이드로 바꾼다.
SUPPORTED_SPECS: dict[str, VehicleSpec] = {
    spec.spec_id: spec for spec in (DEMO_SPEC, SONATA_2014_SPEC)
}


def get_spec(spec_id: str) -> VehicleSpec | None:
    return SUPPORTED_SPECS.get(spec_id)


def match_spec(year: int, make: str | None, model: str | None) -> VehicleSpec | None:
    """The vehicle-specific guide whose year, make and model all match, if any."""
    for spec in SUPPORTED_SPECS.values():
        if (
            spec.make and spec.model
            and spec.years[0] <= year <= spec.years[1]
            and (make or "").strip().casefold() == spec.make.casefold()
            and (model or "").strip().casefold() == spec.model.casefold()
        ):
            return spec
    return None
