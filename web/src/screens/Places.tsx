import { useEffect, useState } from "react";
import { FindCarAR } from "../components/FindCarAR";
import { Icon } from "../components/Icons";
import { SavedPlaces, PLACE_CATEGORIES } from "../components/SavedPlaces";
import { requestBrowserPermission } from "../lib/permissions";


type ParkingSpot = { lat: number; lon: number; accuracy: number; savedAt: string; note: string };


function readLocal<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; }
  catch { return fallback; }
}

function distanceMiles(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function directionTo(a: { lat: number; lon: number }, b: { lat: number; lon: number }): string {
  const rad = Math.PI / 180;
  const y = Math.sin((b.lon - a.lon) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lon - a.lon) * rad);
  const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return names[Math.round(((Math.atan2(y, x) / rad + 360) % 360) / 45) % 8];
}

function locate(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("Location is unavailable in this browser.")); return; }
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
  });
}

function locationError(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && error.code === 1) return "Allow location access for this site to save your parking spot.";
  return "Could not get your location. Try again when your phone has a signal.";
}

export function Places({ vehicleId, locationAllowed, cameraAllowed, compassAllowed }: { vehicleId: string; locationAllowed: boolean; cameraAllowed: boolean; compassAllowed: boolean }) {
  const parkingKey = `carmori:parking:${vehicleId}`;
  const [parking, setParking] = useState<ParkingSpot | null>(() => readLocal(parkingKey, null));
  const [parkingNote, setParkingNote] = useState(() => parking?.note ?? "");
  const [finding, setFinding] = useState(false);
  const [arOpen, setArOpen] = useState(false);
  const [distance, setDistance] = useState<string | null>(null);
  const [parkingError, setParkingError] = useState<string | null>(null);
  useEffect(() => {
    const update = (event: Event) => { if ((event as CustomEvent<{ vehicleId: string }>).detail?.vehicleId === vehicleId) { const spot = readLocal<ParkingSpot | null>(parkingKey, null); setParking(spot); setParkingNote(spot?.note ?? ""); } };
    window.addEventListener("carmori:parking-saved", update);
    return () => window.removeEventListener("carmori:parking-saved", update);
  }, [parkingKey, vehicleId]);


  const saveParking = async () => {
    if (!locationAllowed) { setParkingError("Location is off. Turn it on in Settings to use parking."); return; }
    setFinding(true); setParkingError(null);
    try {
      const position = await locate();
      const next = { lat: position.coords.latitude, lon: position.coords.longitude,
        accuracy: position.coords.accuracy, savedAt: new Date().toISOString(), note: parkingNote.trim() };
      localStorage.setItem(parkingKey, JSON.stringify(next));
      setParking(next); setDistance(null);
    } catch (error) { setParkingError(locationError(error)); }
    finally { setFinding(false); }
  };

  const findParking = async () => {
    if (!locationAllowed) { setParkingError("Location is off. Turn it on in Settings to use parking."); return; }
    if (!parking) return;
    setFinding(true); setParkingError(null);
    try {
      const position = await locate();
      const here = { lat: position.coords.latitude, lon: position.coords.longitude };
      const miles = distanceMiles(here, parking);
      setDistance(miles < 0.1 ? `${Math.round(miles * 5280)} ft ${directionTo(here, parking)}` : `${miles.toFixed(1)} mi ${directionTo(here, parking)}`);
    } catch (error) { setParkingError(locationError(error)); }
    finally { setFinding(false); }
  };

  const openAr = async () => {
    if (!locationAllowed) { setParkingError("Location is off. Turn it on in Settings to use parking."); return; }
    setParkingError(null);
    // iOS only shows the compass prompt from a tap, so ask before the AR view opens.
    if (compassAllowed) await requestBrowserPermission("motion");
    setArOpen(true);
  };

  const saveNote = () => {
    if (!parking) return;
    const next = { ...parking, note: parkingNote.trim() };
    localStorage.setItem(parkingKey, JSON.stringify(next)); setParking(next);
  };

  const clearParking = () => {
    try { localStorage.removeItem(parkingKey); setParking(null); setParkingNote(""); setDistance(null); setArOpen(false); setParkingError(null); }
    catch { setParkingError("Could not clear the parking spot. Please try again."); }
  };
  return <div className="places-screen compact-places">
    <section aria-label="Find nearby"><h2>Find nearby</h2><div className="nearby-shortcuts">{PLACE_CATEGORIES.map((category) => <a key={category.id} href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${category.query} near me`)}`} target="_blank" rel="noopener noreferrer"><Icon name={category.icon} size={20}/><span>{category.plural}</span><Icon name="arrow" size={15}/></a>)}</div></section>
    {parking ? <section className="places-card parking-saved" aria-label="Find my car"><div className="places-card-heading"><span className="places-icon"><Icon name="pin" size={21}/></span><div><h2>Find my car</h2><p>{parking.note || "Saved parking spot"}</p><small>Saved {new Date(parking.savedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</small></div></div>
      {distance && <p className="places-distance" role="status">{distance} · Approximate straight-line distance</p>}
      <div className="places-actions">{cameraAllowed ? <button type="button" className="places-primary" onClick={() => void openAr()} disabled={finding}><Icon name="camera" size={18}/>Find my car in AR</button> : <button type="button" className="places-primary" onClick={() => void findParking()} disabled={finding}>{finding ? "Locating…" : "Find my car"}</button>}</div>
      <details className="parking-edit"><summary>Edit parking spot</summary><label className="places-note-label">Parking note<input value={parkingNote} maxLength={80} onChange={(event) => setParkingNote(event.target.value)} placeholder="Level 3, space B12"/></label><div className="places-actions"><button type="button" onClick={() => { try { saveNote(); setParkingError(null); } catch { setParkingError("Could not save your note on this device."); } }}>Save note</button><button type="button" onClick={() => void saveParking()} disabled={finding}>{finding ? "Locating…" : "Update location"}</button><button type="button" onClick={clearParking}>Clear spot</button></div><p className="places-help">{parking.lat.toFixed(5)}, {parking.lon.toFixed(5)} · ±{Math.round(parking.accuracy)} m</p></details>
    </section> : <details className="parking-shortcut"><summary><Icon name="pin" size={20}/><span><strong>Find my car</strong><small>Save your parking spot</small></span><Icon name="plus" size={17}/></summary><p className="places-help">Save a level or space number for indoor parking.</p><label className="places-note-label">Parking note<input value={parkingNote} maxLength={80} onChange={(event) => setParkingNote(event.target.value)} placeholder="Level 3, space B12"/></label><button type="button" className="places-primary places-full" onClick={() => void saveParking()} disabled={finding}>{finding ? "Locating…" : "Save current location"}</button></details>}
    {parkingError && <p className="places-error" role="alert">{parkingError}</p>}
    <SavedPlaces vehicleId={vehicleId} locationAllowed={locationAllowed}/>
    {arOpen && parking && <FindCarAR spot={parking} compassAllowed={compassAllowed} onClose={() => setArOpen(false)}/>}
    <p className="places-privacy">Parking and saved places stay on this device. Maps open only when you tap.</p>
  </div>;
}
