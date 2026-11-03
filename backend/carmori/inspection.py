"""One-photo visual inspection. Boxes are model output, never fixed UI coordinates."""

from __future__ import annotations

import json
import logging
from typing import Literal, Protocol

from pydantic import BaseModel, Field

from .models import ProductClass
from .products import ProductVerdict, evaluate_product
from .spark import MetaSparkClient, _strip_json
from .vehicles import DEMO_SPEC

log = logging.getLogger("carmori.inspection")

TireViewQuality = Literal["good", "blurry", "dark", "too_small", "wrong_view", "no_tire", "unclear"]
# A tire whose box spans less than this share of the frame is too far away to inspect.
MIN_TIRE_BOX_SPAN = 0.35


def _normalized_box(box: object) -> list[float] | None:
    if not (isinstance(box, list) and len(box) == 4 and all(isinstance(x, (int, float)) and not isinstance(x, bool) and 0 <= x <= 1 for x in box)):
        return None
    return box if box[0] < box[2] and box[1] < box[3] else None


def _tire_rejection_message(reason: str, photo_type: str) -> str:
    sidewall = photo_type == "tire_sidewall"
    return {
        "blurry": "The view is blurry. Hold still.",
        "dark": "It's too dark here. Add light or change the angle.",
        "too_small": "Move closer so the tire fills the view.",
        "wrong_view": "That isn't the sidewall. Show the outer wall of the tire." if sidewall else "That isn't the tread. Show the surface that touches the road.",
        "no_tire": "I don't see a real tire here. Point the camera at the tire.",
    }.get(reason, "I can't clearly see the tire sidewall. Move closer and hold still." if sidewall else "I can't clearly see the tread surface. Move closer and hold still.")


class InspectionResult(BaseModel):
    status: Literal["located", "uncertain", "unavailable"]
    component: Literal["washer_fluid", "tires"]
    observation: str
    box: list[float] | None = Field(default=None, min_length=4, max_length=4)
    confidence: Literal["high", "medium", "low", "unknown"] = "unknown"
    product_status: Literal["MATCH", "CONFLICT", "UNKNOWN"] = "UNKNOWN"
    product_label: str | None = None
    source: Literal["meta_vision", "unavailable"] = "unavailable"
    tire_view_valid: bool | None = None
    tire_findings: list[Literal["bulge", "cut", "crack", "uneven_wear", "wear_bar_level"]] = Field(default_factory=list)
    gauge_value: float | None = None
    gauge_unit: Literal["mm", "32nds_inch"] | None = None
    # Display only: outlines the tire on the camera view. Never decides whether a step passes on its own.
    tire_box: list[float] | None = Field(default=None, min_length=4, max_length=4)
    view_quality: TireViewQuality | None = None
    rejection_reason: TireViewQuality | None = None


class Inspector(Protocol):
    async def analyze(self, jpeg: bytes, component: str, photo_type: str) -> InspectionResult: ...


class UnavailableInspector:
    async def analyze(self, jpeg: bytes, component: str, photo_type: str) -> InspectionResult:
        return InspectionResult(
            status="unavailable", component=component, observation="AI image analysis is unavailable. Retry when Meta Vision is connected or use your vehicle manual."
        )


class MetaInspector:
    def __init__(self, spark: MetaSparkClient) -> None:
        self.spark = spark

    async def analyze(self, jpeg: bytes, component: str, photo_type: str) -> InspectionResult:
        if component == "washer_fluid" and photo_type == "engine":
            prompt = (
                "Find the windshield-washer fluid filler cap in this engine-bay photo. Inspect the whole frame, "
                "including the lower left and right corners. A washer cap is often blue and attached to a narrow "
                "white or translucent filler neck. The windshield-spray symbol may face away from the camera. "
                "Locate the cap only when either its washer symbol/label is readable, or the cap AND narrow filler-neck "
                "construction together make the washer inlet unambiguous. Blue color alone is not enough. "
                "Do not confuse it with the oil-fill cap on the engine, a coolant reservoir or radiator pressure cap, "
                "or a brake-fluid cap near the windshield. Put a tight box around the cap, not the entire reservoir. "
                "Return JSON only: {\"located\": boolean, \"confidence\": \"high|medium|low\", "
                "\"basis\": \"symbol|cap_and_neck|uncertain\", \"box\": [left,top,right,bottom] or null, "
                "\"observation\": short string}. "
                "Box coordinates must be normalized 0..1 on the original image. If uncertain, set located false and box null."
            )
        elif component == "washer_fluid" and photo_type == "product":
            prompt = (
                "Read this automotive product label. Return JSON only: "
                "{\"label\": exact readable text or null, \"class\": \"washer_fluid|coolant|oil|other|unreadable\", "
                "\"confidence\": \"high|medium|low\"}. Use other if the item is clearly not washer fluid, even without readable text. "
                "Do not guess obscured words or judge by color."
            )
        elif component == "tires" and photo_type == "tire_tread_gauge":
            prompt = (
                "Read the measurement on a physical tire tread-depth gauge placed in a tire groove. "
                "The gauge scale or display AND its unit must be clearly visible in this photo. "
                "A tire alone, a pressure gauge, a screenshot, or a ruler not inserted in the tread is invalid. "
                "For analog gauges, read only an unambiguous mark; never estimate from color bands. "
                "Return JSON only: {\"gauge_visible\": boolean, \"reading\": number or null, "
                "\"unit\": \"mm|32nds_inch|unknown\", \"confidence\": \"high|medium|low\"}. "
                "If digits, pointer, or unit are unclear, set gauge_visible false, reading null, unit unknown."
            )
        elif component == "tires" and photo_type in {"tire_sidewall", "tire_tread"}:
            view = "sidewall, including the outer tire wall" if photo_type == "tire_sidewall" else "tread surface that contacts the road"
            prompt = (
                f"This is a tire inspection. Verify that the photo clearly shows the {view}. "
                "A wheel, rim, other car part, screen displaying a tire, or blurred/dark photo is not a valid tire view. "
                "Return JSON only: {\"view_valid\": boolean, \"confidence\": \"high|medium|low\", "
                "\"view_quality\": \"good|blurry|dark|too_small|wrong_view|no_tire|unclear\", "
                "\"tire_box\": [left,top,right,bottom] normalized 0..1 around the whole tire, or null if no real tire is visible, "
                "\"findings\": array drawn only from [\"bulge\",\"cut\",\"crack\",\"uneven_wear\",\"wear_bar_level\"], "
                "\"observation\": short visible detail}. "
                "For sidewall, report only bulge/cut/crack. For tread, report only uneven_wear/wear_bar_level. "
                "Use an empty findings array when no issue is clearly visible. Do not infer wheel position, "
                "tread depth, tire pressure, or roadworthiness from a photo."
            )
        else:
            prompt = (
                "Inspect this tire photo only for visible sidewall damage or visibly uneven wear. "
                "Do not estimate tread depth or pressure. Return JSON only: "
                "{\"observation\": short string, \"confidence\": \"high|medium|low\"}."
            )
        raw = await self.spark._vision_request(prompt, [jpeg])
        if component == "washer_fluid" and photo_type == "engine":
            # Every failed search looks the same to the user; the raw reply shows why it failed.
            log.info("inlet search jpeg_bytes=%d reply=%s", len(jpeg), raw[:500])
        try:
            parsed = json.loads(_strip_json(raw))
        except (ValueError, TypeError):
            parsed = {}
        if not isinstance(parsed, dict):
            parsed = {}
        confidence = parsed.get("confidence") if parsed.get("confidence") in {"high", "medium", "low"} else "unknown"
        if component == "washer_fluid" and photo_type == "product":
            label = parsed.get("label") if isinstance(parsed.get("label"), str) else None
            kind = parsed.get("class")
            product_class = ProductClass(kind) if kind in {item.value for item in ProductClass} else ProductClass.UNREADABLE
            verdict = evaluate_product(label, product_class, DEMO_SPEC) if confidence == "high" else ProductVerdict.UNKNOWN
            if confidence == "high" and product_class is ProductClass.OTHER and not label:
                verdict = ProductVerdict.CONFLICT
            product_status = verdict.value
            message = "Washer fluid is visible on the label." if product_status == "MATCH" else "This isn't washer fluid. Don't pour it." if product_status == "CONFLICT" else "The product could not be verified. Show the full label again."
            return InspectionResult(status="located" if product_status == "MATCH" else "uncertain", component="washer_fluid", observation=message, confidence=confidence, product_status=product_status, product_label=label, source="meta_vision")
        if component == "washer_fluid":
            box = parsed.get("box")
            basis = parsed.get("basis")
            model_observation = parsed.get("observation")
            unclear_message = "I couldn't verify the washer cap. Try another angle or check your vehicle manual."
            if isinstance(model_observation, str):
                if any(word in model_observation.lower() for word in ("black", "dark", "underexposed")):
                    unclear_message = "The captured camera frame is too dark. Add light and try again."
                elif any(word in model_observation.lower() for word in ("blurry", "blurred", "out of focus")):
                    unclear_message = "The captured camera frame is blurry. Hold the phone still and try again."
            valid_box = (
                isinstance(box, list) and len(box) == 4 and all(isinstance(x, (int, float)) and 0 <= x <= 1 for x in box)
                and box[0] < box[2] and box[1] < box[3]
            )
            located = parsed.get("located") is True and confidence == "high" and basis in {"symbol", "cap_and_neck"} and valid_box
            return InspectionResult(
                status="located" if located else "uncertain", component="washer_fluid",
                observation=("Washer symbol found on the marked cap." if basis == "symbol" else "Likely washer cap on the narrow filler neck. Check the cap before opening it.") if located
                else unclear_message,
                box=box if located else None, confidence=confidence, source="meta_vision",
            )
        if photo_type == "tire_tread_gauge":
            value = parsed.get("reading")
            unit = parsed.get("unit")
            valid = (parsed.get("gauge_visible") is True and confidence == "high"
                     and isinstance(value, (int, float)) and not isinstance(value, bool)
                     and unit in {"mm", "32nds_inch"}
                     and 0 < value <= (30 if unit == "mm" else 32))
            return InspectionResult(
                status="located" if valid else "uncertain", component="tires",
                observation=f"Gauge appears to read {value:g} {'mm' if unit == 'mm' else '32nds inch'}. Confirm before saving." if valid else "I can't read the gauge and unit clearly. Move closer and hold still.",
                confidence=confidence, source="meta_vision", gauge_value=float(value) if valid else None,
                gauge_unit=unit if valid else None,
            )
        if photo_type in {"tire_sidewall", "tire_tread"}:
            quality = parsed.get("view_quality") if parsed.get("view_quality") in {"good", "blurry", "dark", "too_small", "wrong_view", "no_tire", "unclear"} else "unclear"
            tire_box = _normalized_box(parsed.get("tire_box"))
            if quality == "good" and tire_box and max(tire_box[2] - tire_box[0], tire_box[3] - tire_box[1]) < MIN_TIRE_BOX_SPAN:
                quality = "too_small"
            valid_view = parsed.get("view_valid") is True and confidence == "high" and quality == "good"
            allowed = {"bulge", "cut", "crack"} if photo_type == "tire_sidewall" else {"uneven_wear", "wear_bar_level"}
            raw_findings = parsed.get("findings")
            findings = list(dict.fromkeys(item for item in raw_findings if isinstance(item, str) and item in allowed)) if isinstance(raw_findings, list) and valid_view else []
            if not valid_view:
                message = _tire_rejection_message(quality, photo_type)
            elif findings:
                message = "Possible visible issue: " + ", ".join(item.replace("_", " ") for item in findings) + ". Have a tire professional check it."
            else:
                message = "No obvious issue in this view. Tread depth and pressure still need a gauge."
            return InspectionResult(status="located" if valid_view else "uncertain", component="tires", observation=message,
                                    confidence=confidence, source="meta_vision", tire_view_valid=valid_view, tire_findings=findings,
                                    tire_box=None if quality == "no_tire" else tire_box, view_quality=quality,
                                    rejection_reason=None if valid_view else ("unclear" if quality == "good" else quality))
        observation = parsed.get("observation") if isinstance(parsed.get("observation"), str) else "The tire photo was unclear."
        return InspectionResult(status="uncertain", component="tires", observation=f"Possible visual observation: {observation} Measure tread and pressure separately.", confidence=confidence, source="meta_vision")
