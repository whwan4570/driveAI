import type { DriveFix } from "./driveMetrics";

export type PlaceCategory = "fuel" | "repair" | "wash";
export type SavedVehiclePlace = { id: string; name: string; address: string; lat?: number; lon?: number };
export type PlaceVisit = { id: string; category: PlaceCategory; name: string; confirmedAt: string };
export type PlaceVisitPrompt = { kind: "visit"; category: PlaceCategory; name: string; placeId: string };
export type NearbyPlace = { id: string; category: PlaceCategory; name: string; lat: number; lon: number; distance_m: number };

const CATEGORIES: { category: PlaceCategory; key: string }[] = [
  { category: "fuel", key: "fuel-stations" },
  { category: "repair", key: "garages" },
  { category: "wash", key: "car-washes" },
];

function readJson<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}

export function readSavedVehiclePlaces(vehicleId: string): { category: PlaceCategory; place: SavedVehiclePlace }[] {
  return CATEGORIES.flatMap(({ category, key }) =>
    readJson<SavedVehiclePlace[]>(`carmori:${key}:${vehicleId}`, []).map((place) => ({ category, place })));
}

export function placeVisitsKey(vehicleId: string): string { return `carmori:place-visits:${vehicleId}`; }
export function readPlaceVisits(vehicleId: string): PlaceVisit[] { return readJson(placeVisitsKey(vehicleId), []); }

export function savePlaceVisit(vehicleId: string, prompt: PlaceVisitPrompt): PlaceVisit {
  const visit = { id: crypto.randomUUID(), category: prompt.category, name: prompt.name, confirmedAt: new Date().toISOString() };
  localStorage.setItem(placeVisitsKey(vehicleId), JSON.stringify([visit, ...readPlaceVisits(vehicleId)].slice(0, 100)));
  return visit;
}

export function saveParkingSpot(vehicleId: string, fix: DriveFix): void {
  const key = `carmori:parking:${vehicleId}`;
  localStorage.setItem(key, JSON.stringify({ lat: fix.latitude, lon: fix.longitude, accuracy: fix.accuracy,
    savedAt: new Date(fix.timestamp).toISOString(), note: "" }));
  window.dispatchEvent(new CustomEvent("carmori:parking-saved", { detail: { vehicleId } }));
}

export function distanceMetres(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const radians = Math.PI / 180;
  const lat = (b.latitude - a.latitude) * radians;
  const lon = (b.longitude - a.longitude) * radians;
  const h = Math.sin(lat / 2) ** 2 + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(lon / 2) ** 2;
  return 12_742_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Match saved places and, when enabled, nearby map results against fresh GPS fixes. */
export class PlaceVisitDetector {
  private candidateId: string | null = null;
  private since = 0;
  private lastPrompted: Record<string, number>;
  private nearby: NearbyPlace[] = [];

  constructor(private vehicleId: string) {
    this.lastPrompted = readJson<Record<string, number>>(`carmori:place-prompted:${vehicleId}`, {});
  }

  setNearby(places: NearbyPlace[]): void { this.nearby = places; }

  observe(fix: DriveFix): PlaceVisitPrompt | null {
    if (fix.accuracy > 60 || (fix.speed ?? 0) > 1.5 || Date.now() - fix.timestamp > 30_000) {
      this.candidateId = null;
      return null;
    }
    const local = readSavedVehiclePlaces(this.vehicleId);
    const remote = this.nearby.map((place) => ({ category: place.category, place: { id: place.id, name: place.name, address: "", lat: place.lat, lon: place.lon } }));
    const found = [...local, ...remote].map(({ category, place }) => ({ category, place,
      metres: typeof place.lat === "number" && typeof place.lon === "number" ? distanceMetres(fix, { latitude: place.lat, longitude: place.lon }) : Infinity,
    })).filter((item) => item.metres <= 60).sort((a, b) => a.metres - b.metres)[0];
    if (!found) { this.candidateId = null; return null; }
    if (this.candidateId !== found.place.id) { this.candidateId = found.place.id; this.since = fix.timestamp; return null; }
    if (fix.timestamp - this.since < 90_000 || fix.timestamp - (this.lastPrompted[found.place.id] ?? 0) < 12 * 60 * 60_000) return null;
    this.lastPrompted[found.place.id] = fix.timestamp;
    try { localStorage.setItem(`carmori:place-prompted:${this.vehicleId}`, JSON.stringify(this.lastPrompted)); } catch { /* Session-only suppression is still useful. */ }
    return { kind: "visit", category: found.category, name: found.place.name, placeId: found.place.id };
  }
}
