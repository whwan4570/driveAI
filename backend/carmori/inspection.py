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


class InspectionResult(BaseModel):
    status: Literal["located", "uncertain", "unavailable"]
    component: Literal["washer_fluid", "tires"]
    observation: str
    box: list[float] | None = Field(default=None, min_length=4, max_length=4)
    confidence: Literal["high", "medium", "low", "unknown"] = "unknown"
    product_status: Literal["MATCH", "CONFLICT", "UNKNOWN"] = "UNKNOWN"
    product_label: str | None = None
    source: Literal["meta_vision", "unavailable"] = "unavailable"


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
            valid_box = (
                isinstance(box, list) and len(box) == 4 and all(isinstance(x, (int, float)) and 0 <= x <= 1 for x in box)
                and box[0] < box[2] and box[1] < box[3]
            )
            located = parsed.get("located") is True and confidence == "high" and basis in {"symbol", "cap_and_neck"} and valid_box
            return InspectionResult(
                status="located" if located else "uncertain", component="washer_fluid",
                observation=("Washer symbol found on the marked cap." if basis == "symbol" else "Likely washer cap on the narrow filler neck. Check the cap before opening it.") if located
                else "I couldn't verify the washer cap. Try another angle or check your vehicle manual.",
                box=box if located else None, confidence=confidence, source="meta_vision",
            )
        observation = parsed.get("observation") if isinstance(parsed.get("observation"), str) else "The tire photo was unclear."
        return InspectionResult(status="uncertain", component="tires", observation=f"Possible visual observation: {observation} Measure tread and pressure separately.", confidence=confidence, source="meta_vision")
