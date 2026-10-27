"""Make and model lists for the vehicle picker.

Makes are a fixed list of US-market passenger brands. Models come from NHTSA vPIC
for that make (and model year when known), limited to cars, SUVs/MPVs, and trucks
so motorcycles and equipment do not appear.
"""

from __future__ import annotations

import asyncio
from typing import Protocol

import httpx

POPULAR_MAKES: tuple[str, ...] = ("Toyota", "Honda", "Ford", "Chevrolet", "Tesla", "Hyundai", "Nissan", "Kia")

MAKES: tuple[str, ...] = (
    "Acura", "Alfa Romeo", "Audi", "BMW", "Buick", "Cadillac", "Chevrolet", "Chrysler",
    "Dodge", "Fiat", "Ford", "Genesis", "GMC", "Honda", "Hyundai", "Infiniti",
    "Jaguar", "Jeep", "Kia", "Land Rover", "Lexus", "Lincoln", "Lucid", "Maserati",
    "Mazda", "Mercedes-Benz", "Mini", "Mitsubishi", "Nissan", "Polestar", "Porsche", "Ram",
    "Rivian", "Subaru", "Tesla", "Toyota", "Volkswagen", "Volvo",
)

VEHICLE_TYPES = ("car", "mpv", "truck")


class ModelCatalog(Protocol):
    async def models(self, make: str, year: int | None) -> list[str]: ...


class NhtsaModelCatalog:
    """Successful lookups are cached for the life of the process; failures are not."""

    def __init__(self, timeout_s: float = 6.0) -> None:
        self.timeout_s = timeout_s
        self._cache: dict[tuple[str, int | None], list[str]] = {}

    async def models(self, make: str, year: int | None) -> list[str]:
        key = (make.casefold(), year)
        if key in self._cache:
            return self._cache[key]
        async with httpx.AsyncClient(timeout=self.timeout_s) as client:
            responses = await asyncio.gather(*(self._fetch(client, make, year, kind) for kind in VEHICLE_TYPES))
        names: dict[str, str] = {}
        for results in responses:
            for row in results:
                name = row.get("Model_Name")
                if isinstance(name, str) and name.strip():
                    names.setdefault(name.strip().casefold(), name.strip())
        models = sorted(names.values(), key=str.casefold)
        self._cache[key] = models
        return models

    @staticmethod
    async def _fetch(client: httpx.AsyncClient, make: str, year: int | None, kind: str) -> list[dict]:
        year_part = f"/modelyear/{year}" if year else ""
        response = await client.get(
            f"https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/{make}{year_part}/vehicletype/{kind}",
            params={"format": "json"},
        )
        response.raise_for_status()
        results = response.json().get("Results")
        return results if isinstance(results, list) else []
