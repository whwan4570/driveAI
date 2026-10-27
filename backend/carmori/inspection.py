"""One-photo visual inspection. Boxes are model output, never fixed UI coordinates."""

from __future__ import annotations

import json
from typing import Literal, Protocol

from pydantic import BaseModel, Field

from .models import ProductClass
from .products import ProductVerdict, evaluate_product
from .spark import MetaSparkClient, _strip_json
from .vehicles import DEMO_SPEC


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
                "Inspect this engine-bay photo for a windshield-washer fluid filler cap. "
                "Only locate it if the windshield-spray symbol or an unambiguous washer label is visible. "
                "Return JSON only: {\"located\": boolean, \"confidence\": \"high|medium|low\", "
                "\"box\": [left,top,right,bottom] or null, \"observation\": short string}. "
                "Box coordinates must be normalized 0..1 on the original image. If uncertain, set located false and box null."
            )
        elif component == "washer_fluid" and photo_type == "product":
            prompt = (
                "Read this automotive product label. Return JSON only: "
                "{\"label\": exact readable text or null, \"class\": \"washer_fluid|coolant|oil|other|unreadable\", "
                "\"confidence\": \"high|medium|low\"}. Do not guess obscured words."
            )
        else:
            prompt = (
                "Inspect this tire photo only for visible sidewall damage or visibly uneven wear. "
                "Do not estimate tread depth or pressure. Return JSON only: "
                "{\"observation\": short string, \"confidence\": \"high|medium|low\"}."
            )
        raw = await self.spark._vision_request(prompt, [jpeg])
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
            product_status = verdict.value
            message = "Washer fluid is visible on the label." if product_status == "MATCH" else "The label appears to show a different product." if product_status == "CONFLICT" else "The product could not be verified. Show the full label again."
            return InspectionResult(status="located" if product_status == "MATCH" else "uncertain", component="washer_fluid", observation=message, confidence=confidence, product_status=product_status, product_label=label, source="meta_vision")
        if component == "washer_fluid":
            box = parsed.get("box")
            valid_box = (
                isinstance(box, list) and len(box) == 4 and all(isinstance(x, (int, float)) and 0 <= x <= 1 for x in box)
                and box[0] < box[2] and box[1] < box[3]
            )
            located = parsed.get("located") is True and confidence == "high" and valid_box
            return InspectionResult(
                status="located" if located else "uncertain", component="washer_fluid",
                observation="Washer inlet located. Confirm the symbol on the cap before opening it." if located else "We couldn't reliably locate the washer fluid reservoir. Try another angle or check your vehicle manual.",
                box=box if located else None, confidence=confidence, source="meta_vision",
            )
        observation = parsed.get("observation") if isinstance(parsed.get("observation"), str) else "The tire photo was unclear."
        return InspectionResult(status="uncertain", component="tires", observation=f"Possible visual observation: {observation} Measure tread and pressure separately.", confidence=confidence, source="meta_vision")
