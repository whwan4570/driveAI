"""Private, bounded PDF cache for verified owner-manual URLs."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from uuid import uuid4

import httpx

from .manual_catalog import OwnerManual, match_owner_manual
from .models import VehicleProfile


MAX_MANUAL_BYTES = 70 * 1024 * 1024
_log = logging.getLogger("carmori.manual_cache")


class ManualCache:
    def __init__(self, directory: Path, client: httpx.AsyncClient | None = None):
        self.directory = directory
        self.client = client
        self._queued: set[str] = set()
        self._errors: set[str] = set()
        self._locks: dict[str, asyncio.Lock] = {}

    def path(self, manual: OwnerManual) -> Path:
        return self.directory / manual.filename

    def ready(self, manual: OwnerManual) -> bool:
        path = self.path(manual)
        if not path.is_file() or not 8 <= path.stat().st_size <= MAX_MANUAL_BYTES:
            return False
        with path.open("rb") as pdf:
            return pdf.read(5) == b"%PDF-"

    def status(self, vehicle: VehicleProfile) -> dict:
        manual = match_owner_manual(vehicle)
        if manual is None:
            return {"status": "unsupported", "title": None, "source_url": None, "manual_url": None}
        state = ("ready" if self.ready(manual) else "downloading" if manual.key in self._queued
                 else "failed" if manual.key in self._errors else "available")
        return {"status": state, "title": manual.title, "source_url": manual.source_url,
                "manual_url": f"/vehicles/{vehicle.vehicle_id}/owner-manual" if state == "ready" else None}

    def queue(self, vehicle: VehicleProfile) -> bool:
        manual = match_owner_manual(vehicle)
        if manual is None or self.ready(manual) or manual.key in self._queued:
            return False
        self._errors.discard(manual.key)
        self._queued.add(manual.key)
        return True

    async def ensure(self, manual: OwnerManual) -> None:
        lock = self._locks.setdefault(manual.key, asyncio.Lock())
        async with lock:
            if self.ready(manual):
                self._queued.discard(manual.key)
                return
            self.directory.mkdir(parents=True, exist_ok=True)
            target = self.path(manual)
            temporary = self.directory / f".{manual.filename}.{uuid4().hex}.part"
            try:
                if self.client is None:
                    async with httpx.AsyncClient(timeout=httpx.Timeout(45, connect=10), follow_redirects=True) as client:
                        await self._download(client, manual, temporary)
                else:
                    await self._download(self.client, manual, temporary)
                temporary.replace(target)
                self._errors.discard(manual.key)
            except (httpx.HTTPError, OSError, ValueError) as exc:
                self._errors.add(manual.key)
                _log.warning("Owner manual download failed for %s: %s", manual.key, exc)
            finally:
                temporary.unlink(missing_ok=True)
                self._queued.discard(manual.key)

    async def _download(self, client: httpx.AsyncClient, manual: OwnerManual, temporary: Path) -> None:
        total = 0
        async with client.stream("GET", manual.source_url) as response:
            response.raise_for_status()
            content_length = response.headers.get("content-length")
            if content_length and int(content_length) > MAX_MANUAL_BYTES:
                raise ValueError("owner manual exceeds size limit")
            with temporary.open("wb") as pdf:
                async for chunk in response.aiter_bytes():
                    total += len(chunk)
                    if total > MAX_MANUAL_BYTES:
                        raise ValueError("owner manual exceeds size limit")
                    pdf.write(chunk)
        if total < 8:
            raise ValueError("empty owner manual")
        with temporary.open("rb") as pdf:
            if pdf.read(5) != b"%PDF-":
                raise ValueError("owner manual source did not return a PDF")
