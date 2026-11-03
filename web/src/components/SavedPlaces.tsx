import { useState, type FormEvent } from "react";
import { Icon } from "./Icons";

export const PLACE_CATEGORIES = [
  { id: "fuel-stations", label: "Gas station", plural: "Gas stations", query: "gas station", icon: "fuel" },
  { id: "garages", label: "Repair shop", plural: "Repair shops", query: "auto repair", icon: "wrench" },
  { id: "car-washes", label: "Car wash", plural: "Car washes", query: "car wash", icon: "car" },
  { id: "supplies", label: "Supplies", plural: "Supplies", query: "auto parts store", icon: "bag" },
] as const;
type Category = typeof PLACE_CATEGORIES[number]["id"];
export type SavedPlace = { id: string; name: string; address: string; lat?: number; lon?: number };
type ListedPlace = SavedPlace & { category: Category };
function key(vehicleId: string, category: Category) { return `carmori:${category}:${vehicleId}`; }
function readAll(vehicleId: string): ListedPlace[] {
  return PLACE_CATEGORIES.flatMap(({ id }) => {
    const stored: unknown = JSON.parse(localStorage.getItem(key(vehicleId, id)) || "[]");
    if (!Array.isArray(stored)) return [];
    return stored.filter((p): p is SavedPlace => p && typeof p.id === "string" && typeof p.name === "string" && typeof p.address === "string")
      .map((p) => ({ ...p, category: id }));
  });
}
export function SavedPlaces({ vehicleId, locationAllowed }: { vehicleId: string; locationAllowed: boolean }) {
  const [saved, setSaved] = useState<ListedPlace[]>(() => { try { return readAll(vehicleId); } catch { return []; } });
  const [adding, setAdding] = useState(false);
  const [category, setCategory] = useState<Category>("garages");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [pin, setPin] = useState<{ lat: number; lon: number } | null>(null);
  const [pinning, setPinning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      const existing = readAll(vehicleId);
      const place = { id: crypto.randomUUID(), name: name.trim(), address: address.trim(), ...(pin ?? {}) };
      localStorage.setItem(key(vehicleId, category), JSON.stringify([...existing.filter((p) => p.category === category).map(({ category: _, ...p }) => p), place]));
      setSaved(readAll(vehicleId)); setAdding(false); setName(""); setAddress(""); setPin(null); setError(null);
    } catch { setError("Could not save this place on this device. Your existing places were not replaced."); }
  };
  const remove = (place: ListedPlace) => {
    try {
      const existing = readAll(vehicleId);
      localStorage.setItem(key(vehicleId, place.category), JSON.stringify(existing.filter((p) => p.category === place.category && p.id !== place.id).map(({ category: _, ...p }) => p)));
      setSaved(readAll(vehicleId)); setError(null);
    } catch { setError("Could not remove this place. Please try again."); }
  };
  const pinHere = () => {
    if (!locationAllowed) { setError("Enable Location in Settings before pinning a place."); return; }
    if (!navigator.geolocation) { setError("Location is unavailable in this browser."); return; }
    setPinning(true); setError(null);
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      setPinning(false);
      if (coords.accuracy > 100) { setError("Location is too imprecise. Try outdoors or enter an address."); return; }
      setPin({ lat: coords.latitude, lon: coords.longitude });
    }, () => { setPinning(false); setError("Could not get your location. You can enter an address instead."); }, { enableHighAccuracy: true, timeout: 12000 });
  };
  return <section className="saved-places-section" aria-label="Saved places">
    <div className="places-section-heading"><h2>Saved places</h2><button type="button" onClick={() => { setAdding(!adding); setError(null); }}>{adding ? "Cancel" : "+ Add"}</button></div>
    {adding && <form className="places-garage-form k-form" onSubmit={add}>
      <label>Category<select value={category} onChange={(e) => setCategory(e.target.value as Category)}>{PLACE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      <label>Place name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required/></label>
      <label>Address <span className="optional">optional</span><input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={160}/></label>
      <button type="button" onClick={pinHere} disabled={pinning}>{pinning ? "Locating…" : pin ? "Current location pinned" : "Pin current location"}</button>
      <button className="places-primary" type="submit" disabled={pinning}>Save place</button>
    </form>}
    {!saved.length && !adding && <p className="places-empty">Your usual stops will appear here.</p>}
    {saved.length > 0 && <div className="saved-places-list">{saved.map((place) => {
      const meta = PLACE_CATEGORIES.find((c) => c.id === place.category)!;
      const target = typeof place.lat === "number" && typeof place.lon === "number" ? `${place.lat},${place.lon}` : [place.name, place.address].filter(Boolean).join(" ");
      return <div className="saved-place-row" key={`${place.category}:${place.id}`}><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(target)}`} target="_blank" rel="noopener noreferrer"><Icon name={meta.icon} size={20}/><span><strong>{place.name}</strong><small>{meta.label}{place.address ? ` · ${place.address}` : ""}</small></span><Icon name="chevron" size={15}/></a><button type="button" aria-label={`Remove ${place.name}`} onClick={() => remove(place)}><Icon name="close" size={15}/></button></div>;
    })}</div>}
    {error && <p className="places-error" role="alert">{error}</p>}
  </section>;
}
