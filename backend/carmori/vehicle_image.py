"""Create a vehicle image from confirmed year, make, model, and paint color."""

from __future__ import annotations

import base64
import binascii
from typing import Protocol

import httpx

from .config import Settings
from .models import VehicleProfile
from .vehicle_cutout import MetaSamVehicleCutout, VehicleCutoutError


class VehicleImageError(Exception):
    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


class VehicleImageGenerator(Protocol):
    async def generate(self, vehicle: VehicleProfile) -> str: ...


class MetaVehicleImageGenerator:
    def __init__(self, settings: Settings, cutout=None) -> None:
        self.settings = settings
        self.cutout = cutout or MetaSamVehicleCutout(settings)

    async def generate(self, vehicle: VehicleProfile) -> str:
        if not self.settings.meta_api_key:
            raise VehicleImageError("Muse Image is not connected yet. Add a Meta Model API key.")
        identity = " ".join(str(value) for value in (vehicle.year, vehicle.make, vehicle.model, vehicle.body_style, vehicle.trim) if value)
        paint = vehicle.exterior_color or ""
        prompt = (
            f"Create one photorealistic studio product image of a {identity} in {paint} exterior paint. "
            "The model year, make, model, body style, generation, headlight shape, grille, roofline, "
            "door count, wheels, and paint color must match the named vehicle. Show the full vehicle "
            "from a front three-quarter angle, centered, with room around it. Clean dark navy studio "
            "background that works on a premium mobile automotive dashboard. Real car photo appearance, "
            "not a cartoon or character. No eyes, mouth, text, watermark, people, or other vehicles."
        )
        base = self.settings.meta_api_base_url.rstrip("/") or "https://api.meta.ai/v1"
        try:
            async with httpx.AsyncClient(timeout=90.0) as client:
                response = await client.post(
                    f"{base}/images/generations",
                    headers={"Authorization": f"Bearer {self.settings.meta_api_key}"},
                    json={"model": "muse-image-1.0", "prompt": prompt, "n": 1,
                          "size": "1536x1024", "response_format": "b64_json", "output_format": "webp"},
                )
                response.raise_for_status()
            encoded = response.json()["data"][0]["b64_json"]
            image = base64.b64decode(encoded, validate=True)
            if not image.startswith(b"RIFF") or image[8:12] != b"WEBP" or len(image) > 4_000_000:
                raise ValueError("invalid generated image")
            return await self.cutout.remove(f"data:image/webp;base64,{encoded}")
        except VehicleCutoutError as exc:
            raise VehicleImageError(exc.args[0]) from exc
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            if status == 402:
                message = "Muse Image billing is not enabled for this Meta team."
            elif status in (401, 403):
                message = "This Meta key does not have Muse Image access yet."
            elif status == 429:
                message = "Muse Image is rate limited. Try again shortly."
            else:
                message = "Muse Image could not create this vehicle image."
            raise VehicleImageError(message) from exc
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError, binascii.Error) as exc:
            raise VehicleImageError("Muse Image is temporarily unavailable. Try again later.") from exc
