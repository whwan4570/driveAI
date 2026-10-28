"""Hosted SAM 3.1 tracking for short washer-guide video clips.

Track IDs are scoped to one request for one uploaded clip and target. A mask locates an object;
it cannot establish its type, cap state, product label, or completed action.
"""

from __future__ import annotations

from contextlib import aclosing
from typing import Literal, Mapping, Protocol

from meta_sam_parser import parse_responses_stream, video_segmentation_format
from openai import AsyncOpenAI
from pydantic import BaseModel

from .config import Settings
from .vehicle_cutout import _parser_events


SamTarget = Literal["cap", "bottle", "inlet"]
CONCEPTS: dict[SamTarget, str] = {
    "cap": "windshield washer fluid reservoir cap",
    "bottle": "windshield washer fluid bottle",
    "inlet": "windshield washer fluid reservoir opening",
}


class SamDetection(BaseModel):
    frame_index: int
    track_id: str
    box: tuple[float, float, float, float]
    confidence: float | None
    mask_encoding: str
    mask_payload: str
    mask_width: int
    mask_height: int


class SamVideoResult(BaseModel):
    target: SamTarget
    model_version: str = "sam-3.1"
    # IDs must not be matched across separate requests, even on the same clip.
    track_scope: Literal["request"] = "request"
    detections: list[SamDetection]


class SamVideoTracker(Protocol):
    async def segment(self, video: bytes, target: SamTarget) -> SamVideoResult: ...


class MetaSamVideoTracker:
    def __init__(self, settings: Settings, concepts: Mapping[SamTarget, str] | None = None) -> None:
        self.settings = settings
        self.concepts = concepts or CONCEPTS

    async def segment(self, video: bytes, target: SamTarget) -> SamVideoResult:
        if not self.settings.meta_api_key:
            raise RuntimeError("Meta API key missing")
        base = self.settings.meta_api_base_url.rstrip("/") or "https://api.meta.ai/v1"
        async with AsyncOpenAI(base_url=base, api_key=self.settings.meta_api_key, timeout=90) as api:
            uploaded = await api.files.create(
                file=("washer-guide.mp4", video, "video/mp4"), purpose="user_data"
            )
            file_id = uploaded.id
            if not isinstance(file_id, str) or not file_id.startswith("file-"):
                raise ValueError("SAM upload returned no file ID")
            try:
                stream = await api.responses.create(
                    model="sam-3.1",
                    stream=True,
                    input=[{"type": "message", "role": "user", "content": [
                        {"type": "input_text", "text": self.concepts[target]},
                        {"type": "input_video", "file_id": file_id},
                    ]}],
                    metadata={"mask_encoding": "one_bit"},
                )
                async with stream, aclosing(_parser_events(stream)) as events:
                    parsed = parse_responses_stream(events, video_segmentation_format())
                    async with parsed:
                        result = await parsed.final_result()
            finally:
                # Uploaded work footage is temporary, not a vehicle record.
                await api.files.delete(file_id)

        if result.outcome.status != "completed" or any(
            issue.severity == "error" for issue in result.diagnostics
        ):
            raise ValueError("SAM video segmentation was incomplete")

        boxes = {(record.object_id, record.frame.frame_index): record
                 for record in result.records if record.kind == "box" and record.frame is not None}
        detections = []
        for record in result.records:
            if record.kind != "mask" or record.frame is None:
                continue
            key = (record.object_id, record.frame.frame_index)
            box = boxes.get(key)
            if box is None:
                continue
            detections.append(SamDetection(
                frame_index=record.frame.frame_index,
                track_id=record.object_id,
                box=(box.left, box.top, box.right, box.bottom),
                confidence=record.confidence if record.confidence is not None else box.confidence,
                mask_encoding=str(record.mask.encoding),
                mask_payload=record.mask.payload,
                mask_width=record.mask.width,
                mask_height=record.mask.height,
            ))
        return SamVideoResult(target=target, detections=detections)
