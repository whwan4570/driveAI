"""Remove an AI car image's background with Meta SAM 3.1."""

from __future__ import annotations

import base64
from contextlib import aclosing
from io import BytesIO
from typing import Any, AsyncIterable, AsyncIterator

from meta_sam_parser import decode_mask_to_raster, image_segmentation_format, parse_responses_stream
from openai import AsyncOpenAI
from PIL import Image

from .config import Settings


class VehicleCutoutError(Exception):
    pass


async def _parser_events(stream: AsyncIterable[Any]) -> AsyncIterator[dict]:
    """Close the output lane when Meta sends content_part.done without text.done."""
    completed: set[tuple[object, object, object]] = set()
    async for event in stream:
        data = event.model_dump() if hasattr(event, "model_dump") else dict(event)
        lane = (data.get("item_id"), data.get("output_index"), data.get("content_index"))
        if data.get("type") == "response.output_text.done":
            if lane not in completed:
                completed.add(lane)
                yield data
            continue
        yield data
        part = data.get("part")
        if (data.get("type") == "response.content_part.done" and lane not in completed
                and isinstance(part, dict) and part.get("type") == "output_text"
                and isinstance(part.get("text"), str)):
            completed.add(lane)
            yield {"type": "response.output_text.done", "item_id": data.get("item_id"),
                   "output_index": data.get("output_index"),
                   "content_index": data.get("content_index"), "text": part["text"]}


def compose_cutout(source: bytes, raster: bytes, mask_size: tuple[int, int],
                   box: tuple[int, int, int, int]) -> bytes:
    """Apply SAM's box-local mask, then crop transparent margins for the vehicle card."""
    image = Image.open(BytesIO(source)).convert("RGBA")
    left, top, right, bottom = box
    width, height = right - left + 1, bottom - top + 1
    if (width < 1 or height < 1 or left < 0 or top < 0
            or right >= image.width or bottom >= image.height
            or len(raster) != mask_size[0] * mask_size[1]):
        raise VehicleCutoutError("Vehicle mask was invalid.")
    alpha = Image.new("L", image.size, 0)
    mask = Image.frombytes("L", mask_size, bytes(255 if pixel else 0 for pixel in raster))
    # SAM masks can be lower resolution than the source image's bounding box.
    mask = mask.resize((width, height), Image.Resampling.BILINEAR)
    alpha.paste(mask, (left, top))
    bounds = alpha.getbbox()
    if bounds is None:
        raise VehicleCutoutError("No vehicle was found in the image.")
    image.putalpha(alpha)
    pad = max(12, round(max(bounds[2] - bounds[0], bounds[3] - bounds[1]) * 0.035))
    image = image.crop((max(0, bounds[0] - pad), max(0, bounds[1] - pad),
                        min(image.width, bounds[2] + pad), min(image.height, bounds[3] + pad)))
    output = BytesIO()
    image.save(output, format="WEBP", quality=90, method=6)
    return output.getvalue()


class MetaSamVehicleCutout:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def remove(self, source_data_url: str) -> str:
        try:
            source = base64.b64decode(source_data_url.split(",", 1)[1], validate=True)
            base = self.settings.meta_api_base_url.rstrip("/") or "https://api.meta.ai/v1"
            async with AsyncOpenAI(base_url=base, api_key=self.settings.meta_api_key,
                                   timeout=120) as api:
                stream = await api.responses.create(
                    model="sam-3.1", stream=True,
                    input=[{"type": "message", "role": "user", "content": [
                        {"type": "input_text", "text": "car"},
                        {"type": "input_image", "image_url": source_data_url},
                    ]}], metadata={"mask_encoding": "one_bit"},
                )
                async with stream, aclosing(_parser_events(stream)) as events:
                    result = await parse_responses_stream(events, image_segmentation_format()).final_result()
            if result.outcome.status != "completed" or any(
                issue.severity == "error" for issue in result.diagnostics
            ):
                raise VehicleCutoutError("Vehicle segmentation was incomplete.")
            boxes = {record.object_id: record for record in result.records if record.kind == "box"}
            masks = [record for record in result.records if record.kind == "mask"
                     and record.object_id in boxes]
            if not masks:
                raise VehicleCutoutError("No vehicle was found in the image.")
            match = max(masks, key=lambda item: (
                (boxes[item.object_id].right - boxes[item.object_id].left + 1)
                * (boxes[item.object_id].bottom - boxes[item.object_id].top + 1)))
            box = boxes[match.object_id]
            output = compose_cutout(source, decode_mask_to_raster(match.mask),
                                    (match.mask.width, match.mask.height),
                                    (box.left, box.top, box.right, box.bottom))
            return "data:image/webp;base64," + base64.b64encode(output).decode("ascii")
        except VehicleCutoutError:
            raise
        except Exception as exc:
            raise VehicleCutoutError("Could not remove the vehicle image background.") from exc
