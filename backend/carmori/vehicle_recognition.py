"""Vehicle onboarding scan. VIN decoding is preferred; exterior ID is a candidate."""

from __future__ import annotations

import base64
import json
import re
from typing import Literal, Protocol

import httpx
from pydantic import BaseModel

from .config import Settings

ScanMode = Literal["vin", "exterior"]
DocumentType = Literal["buyers_guide", "odometer_disclosure", "vehicle_history_report", "window_sticker"]
DocumentMime = Literal["image/jpeg", "image/png", "application/pdf"]
ScanStatus = Literal["recognized", "unrecognized", "unavailable"]
VIN_PATTERN = re.compile(r"^[A-HJ-NPR-Z0-9]{17}$")


class VehicleScanResult(BaseModel):
    status: ScanStatus
    source: Literal["vin", "exterior", "document"]
    make: str | None = None
    model: str | None = None
    year: int | None = None
    trim: str | None = None
    exterior_color: str | None = None
    vin_last4: str | None = None
    document_type: DocumentType | None = None
    message: str


class VehicleRecognizer(Protocol):
    async def recognize(self, jpeg: bytes, mode: ScanMode) -> VehicleScanResult: ...
    async def recognize_document(self, data: bytes, mime: DocumentMime, document_type: DocumentType) -> VehicleScanResult: ...


def clean_vin(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    vin = re.sub(r"[\s-]", "", value).upper()
    return vin if VIN_PATTERN.fullmatch(vin) else None


def clean_name(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    value = " ".join(value.strip().split())
    return value[:60] if value and value.lower() not in {"unknown", "null", "none", "n/a"} else None


def clean_year(value: object) -> int | None:
    try:
        year = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return year if 1981 <= year <= 2035 else None


def clean_exterior_color(value: object) -> str | None:
    color = clean_name(value)
    if not color or not any(word in color.lower() for word in (
        "silver", "white", "gray", "grey", "black", "red", "blue", "green",
        "yellow", "orange", "brown", "beige", "gold", "bronze", "champagne",
    )):
        return None
    return color[:40]


class MetaVehicleRecognizer:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def _content_json(self, prompt: str, content_part: dict) -> dict:
        base = self.settings.meta_api_base_url.rstrip("/") or "https://api.meta.ai/v1"
        async with httpx.AsyncClient(timeout=self.settings.spark_timeout_s) as client:
            response = await client.post(
                f"{base}/chat/completions",
                headers={"Authorization": f"Bearer {self.settings.meta_api_key}"},
                json={
                    "model": self.settings.spark_vision_model,
                    "messages": [{"role": "user", "content": [
                        {"type": "text", "text": prompt},
                        content_part,
                    ]}],
                },
            )
            response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
        if not isinstance(content, str):
            return {}
        text = content.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        try:
            parsed = json.loads(text)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}

    async def _image_json(self, jpeg: bytes, prompt: str) -> dict:
        image = base64.b64encode(jpeg).decode("ascii")
        return await self._content_json(prompt, {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image}"}})

    async def _document_json(self, data: bytes, mime: DocumentMime, prompt: str) -> dict:
        encoded = base64.b64encode(data).decode("ascii")
        if mime == "application/pdf":
            part = {"type": "file", "file": {"filename": "vehicle-document.pdf", "file_data": f"data:application/pdf;base64,{encoded}"}}
        else:
            part = {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{encoded}"}}
        return await self._content_json(prompt, part)

    @staticmethod
    def _model_error_message(status: int) -> str:
        if status == 402:
            return "Meta rejected this API key because billing is not configured for its team. Check Meta Model API Billing."
        if status == 401:
            return "Meta rejected the API key. Check META_API_KEY in the server environment."
        if status == 403:
            return "This Meta API key does not have access to the image model. Check the team's model permissions."
        if status == 429:
            return "Meta's rate limit was reached. Wait a moment and try again."
        return "Recognition is temporarily unavailable. Try again or enter your car manually."

    async def _decode_vin(self, vin: str) -> VehicleScanResult:
        async with httpx.AsyncClient(timeout=6.0) as client:
            response = await client.get(
                f"https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/{vin}",
                params={"format": "json"},
            )
            response.raise_for_status()
        rows = response.json().get("Results", [])
        row = rows[0] if rows and isinstance(rows[0], dict) else {}
        make = clean_name(row.get("Make"))
        model = clean_name(row.get("Model"))
        year = clean_year(row.get("ModelYear"))
        error_code = str(row.get("ErrorCode", ""))
        if not (make and model and year and error_code.split(",")[0].strip() == "0"):
            return VehicleScanResult(status="unrecognized", source="vin", message="VIN could not be verified. Try an exterior scan or enter your car manually.")
        return VehicleScanResult(
            status="recognized", source="vin", make=make, model=model, year=year,
            trim=clean_name(row.get("Trim")), vin_last4=vin[-4:],
            message="Vehicle details decoded from the VIN. Confirm before continuing.",
        )

    async def recognize(self, jpeg: bytes, mode: ScanMode) -> VehicleScanResult:
        if not self.settings.meta_api_key:
            return VehicleScanResult(status="unavailable", source=mode, message="Camera recognition needs a Meta API key. You can add the demo car manually.")
        try:
            if mode == "vin":
                data = await self._image_json(
                    jpeg,
                    "Read the 17-character vehicle VIN printed in this image. Return only JSON: "
                    '{"vin": "EXACT_VALUE_OR_NULL"}. Do not guess missing or unclear characters.',
                )
                vin = clean_vin(data.get("vin"))
                if not vin:
                    return VehicleScanResult(status="unrecognized", source=mode, message="I could not read a complete VIN. Move closer or scan the outside of your car.")
                return await self._decode_vin(vin)
            data = await self._image_json(
                jpeg,
                "Identify the vehicle visible in this photo. Return only JSON: "
                '{"make": "string or null", "model": "string or null", "exterior_color": "common visible paint color or null"}. '
                "Only name a make, model, and paint color when the exterior evidence is clear. Do not infer the model year or trim. Do not guess.",
            )
            make, model = clean_name(data.get("make")), clean_name(data.get("model"))
            if not (make and model):
                return VehicleScanResult(status="unrecognized", source=mode, message="I could not identify the car clearly. Try another angle or enter it manually.")
            return VehicleScanResult(
                status="recognized", source=mode, make=make, model=model,
                exterior_color=clean_exterior_color(data.get("exterior_color")),
                message="Exterior match is an estimate. Confirm the model and enter the year.",
            )
        except httpx.HTTPStatusError as exc:
            return VehicleScanResult(status="unavailable", source=mode, message=self._model_error_message(exc.response.status_code))
        except (httpx.HTTPError, KeyError, ValueError, TypeError):
            return VehicleScanResult(status="unavailable", source=mode, message="Recognition is temporarily unavailable. Try again or enter your car manually.")

    async def recognize_document(self, data: bytes, mime: DocumentMime, document_type: DocumentType) -> VehicleScanResult:
        if not self.settings.meta_api_key:
            return VehicleScanResult(status="unavailable", source="document", document_type=document_type, message="Document reading needs a Meta API key. You can enter the vehicle manually.")
        labels = {
            "buyers_guide": "Buyers Guide",
            "odometer_disclosure": "Odometer Disclosure Statement",
            "vehicle_history_report": "Vehicle History Report",
            "window_sticker": "Window Sticker / Monroney Sticker",
        }
        prompt = (
            f"This is a vehicle purchase document identified as {labels[document_type]}. "
            "Extract only the printed vehicle identity. Return only a JSON object with keys "
            '{"make": null, "model": null, "year": null, "vin": null, "exterior_color": null}. '
            "Replace null only when the value is explicitly printed. Use the model year only if labeled; never use a report date as model year. "
            "Extract the exterior paint color only if explicitly printed. Do not guess missing details. Do not return owner names, addresses, prices, or other personal information."
        )
        try:
            parsed = await self._document_json(data, mime, prompt)
            vin = clean_vin(parsed.get("vin"))
            if vin:
                try:
                    decoded = await self._decode_vin(vin)
                except httpx.HTTPError:
                    decoded = None
                if decoded and decoded.status == "recognized":
                    return decoded.model_copy(update={
                        "source": "document", "document_type": document_type,
                        "exterior_color": clean_exterior_color(parsed.get("exterior_color")),
                        "message": "VIN from the document was decoded. Confirm your vehicle before continuing.",
                    })
            make, model, year = clean_name(parsed.get("make")), clean_name(parsed.get("model")), clean_year(parsed.get("year"))
            if not (make and model):
                return VehicleScanResult(status="unrecognized", source="document", document_type=document_type, message="I could not find a clear make and model in this document. Try another page or enter details manually.")
            return VehicleScanResult(
                status="recognized", source="document", document_type=document_type,
                make=make, model=model, year=year, vin_last4=vin[-4:] if vin else None,
                exterior_color=clean_exterior_color(parsed.get("exterior_color")),
                message="Vehicle details were read from the document. Confirm them before continuing.",
            )
        except httpx.HTTPStatusError as exc:
            return VehicleScanResult(status="unavailable", source="document", document_type=document_type, message=self._model_error_message(exc.response.status_code))
        except (httpx.HTTPError, KeyError, ValueError, TypeError):
            return VehicleScanResult(status="unavailable", source="document", document_type=document_type, message="Document reading is temporarily unavailable. Try again or enter your car manually.")
