"""Opt-in OpenStreetMap lookup for stopped vehicle visit prompts."""

from __future__ import annotations

import math

import httpx

OVERPASS_URL = "https://overpass-api.de/api/interpreter"


async def nearby_vehicle_places(lat: float, lon: float) -> list[dict]:
    query = (
        "[out:json][timeout:8];("
        f'node(around:130,{lat:.6f},{lon:.6f})["amenity"="fuel"];'
        f'way(around:130,{lat:.6f},{lon:.6f})["amenity"="fuel"];'
        f'node(around:130,{lat:.6f},{lon:.6f})["shop"="car_repair"];'
        f'way(around:130,{lat:.6f},{lon:.6f})["shop"="car_repair"];'
        f'node(around:130,{lat:.6f},{lon:.6f})["amenity"="car_wash"];'
        f'way(around:130,{lat:.6f},{lon:.6f})["amenity"="car_wash"];'
        ");out center tags;"
    )
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(OVERPASS_URL, data={"data": query}, headers={"User-Agent": "Carmori-prototype/1.0 (opt-in vehicle visit prompts)"})
        response.raise_for_status()
        elements = response.json().get("elements", [])
    places = []
    for item in elements:
        tags = item.get("tags") or {}
        category = ("fuel" if tags.get("amenity") == "fuel" else
                    "repair" if tags.get("shop") == "car_repair" else
                    "wash" if tags.get("amenity") == "car_wash" else None)
        point = item.get("center") or item
        if category is None or not isinstance(point.get("lat"), (int, float)) or not isinstance(point.get("lon"), (int, float)):
            continue
        metres = math.hypot((point["lat"] - lat) * 111_000, (point["lon"] - lon) * 111_000 * math.cos(math.radians(lat)))
        places.append({"id": f'{item.get("type", "node")}:{item.get("id")}', "category": category,
                       "name": str(tags.get("name") or {"fuel": "Gas station", "repair": "Repair shop", "wash": "Car wash"}[category])[:100],
                       "lat": point["lat"], "lon": point["lon"], "distance_m": round(metres)})
    return sorted(places, key=lambda place: place["distance_m"])[:8]
