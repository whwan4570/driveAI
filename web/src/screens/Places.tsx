import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "../components/Icons";
import { api, type CareResponse, type WasherShoppingPick } from "../lib/api";

type ParkingSpot = { lat: number; lon: number; accuracy: number; savedAt: string; note: string };
type Garage = { id: string; name: string; address: string };

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

export function Places({ vehicleId, care, onAskMuse }: { vehicleId: string; care: CareResponse | null; onAskMuse: () => void }) {
  const parkingKey = `carmori:parking:${vehicleId}`;
  const garagesKey = `carmori:garages:${vehicleId}`;
  const [parking, setParking] = useState<ParkingSpot | null>(() => readLocal(parkingKey, null));
  const [garages, setGarages] = useState<Garage[]>(() => readLocal(garagesKey, []));
  const [parkingNote, setParkingNote] = useState(() => parking?.note ?? "");
  const [finding, setFinding] = useState(false);
  const [distance, setDistance] = useState<string | null>(null);
  const [parkingError, setParkingError] = useState<string | null>(null);
  const [garageName, setGarageName] = useState("");
  const [garageAddress, setGarageAddress] = useState("");
  const [addingGarage, setAddingGarage] = useState(false);
  const [shopping, setShopping] = useState<WasherShoppingPick | null>(null);
  const [shoppingError, setShoppingError] = useState(false);
  const [shoppingLoading, setShoppingLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setShoppingLoading(true);
    void api.washerShopping(vehicleId).then((pick) => { if (active) { setShopping(pick); setShoppingError(false); } })
      .catch(() => { if (active) setShoppingError(true); })
      .finally(() => { if (active) setShoppingLoading(false); });
    return () => { active = false; };
  }, [vehicleId]);

  const washerRecommendation = care?.recommendations.find((item) => item.component === "washer_fluid");
  const washerNeedsCheck = washerRecommendation !== undefined && washerRecommendation.priority !== "ROUTINE";
  const lowF = shopping?.forecast_low_c === null || shopping?.forecast_low_c === undefined ? null : Math.round(shopping.forecast_low_c * 9 / 5 + 32);

  const saveParking = async () => {
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

  const saveNote = () => {
    if (!parking) return;
    const next = { ...parking, note: parkingNote.trim() };
    localStorage.setItem(parkingKey, JSON.stringify(next)); setParking(next);
  };

  const addGarage = (event: FormEvent) => {
    event.preventDefault();
    if (!garageName.trim()) return;
    const next = [...garages, { id: crypto.randomUUID(), name: garageName.trim(), address: garageAddress.trim() }];
    localStorage.setItem(garagesKey, JSON.stringify(next)); setGarages(next);
    setGarageName(""); setGarageAddress(""); setAddingGarage(false);
  };

  const removeGarage = (id: string) => {
    const next = garages.filter((garage) => garage.id !== id);
    localStorage.setItem(garagesKey, JSON.stringify(next)); setGarages(next);
  };

  return <div className="places-screen">
    <section className="shop-hero" aria-label="Washer fluid shopping help">
      <div className="shop-hero-top"><span className="shop-muse-mark"><Icon name="spark" size={17}/> Muse</span><span className="shop-context">{washerNeedsCheck ? "Washer check suggested" : "For your next refill"}</span></div>
      <h1>Need washer fluid?</h1>
      <p className="shop-hero-prompt">Want me to help you find one for the weather?</p>
      {shoppingLoading ? <p className="shop-loading" role="status">Checking the forecast…</p> : shoppingError || !shopping ? <div className="shop-unknown"><Icon name="cloud" size={18}/><span>Weather match unavailable right now. Check the freeze rating before buying.</span></div> : <>
        <div className="shop-weather"><Icon name="cloud" size={17}/><span>{lowF === null ? "Forecast unavailable" : `Today's low ${lowF}°F`}</span><small>{lowF === null ? "Check your expected low before buying" : "Open-Meteo forecast"}</small></div>
        <div className="shop-product">
          {shopping.product_name === "Rain-X 2-in-1 Windshield Washer Fluid" ? <div className="shop-product-image"><img src="/images/rainx-2in1-reference.png" alt="Rain-X 2-in-1 washer fluid bottle"/></div> : <div className="shop-product-placeholder"><Icon name="washer" size={33}/></div>}
          <div className="shop-product-copy"><small>{shopping.forecast_low_c === null ? "Example product" : shopping.product_name ? "Weather matched example" : "Choose by freeze rating"}</small><strong>{shopping.product_name || (shopping.kind === "extreme_cold" ? "Fluid rated below the forecast low" : "Check local freeze rating")}</strong><span>{shopping.freeze_rating_f === null ? "Check the bottle's rating" : `Rated to ${shopping.freeze_rating_f}°F`}</span></div>
        </div>
        <p className="shop-reason">{shopping.reason}{shopping.manufacturer_url && <> <a href={shopping.manufacturer_url} target="_blank" rel="noopener noreferrer">Product details ↗</a></>}</p>
        <div className="shop-actions"><a href={shopping.shop_url} target="_blank" rel="noopener noreferrer">Shop now <Icon name="arrow" size={16}/></a><button type="button" onClick={onAskMuse}>Ask Muse</button></div>
        <p className="shop-disclosure">Check the seller, price and availability before buying.</p>
      </>}
      {(shoppingError || !shopping) && !shoppingLoading && <div className="shop-actions"><a href="https://www.google.com/search?tbm=shop&q=windshield+washer+fluid" target="_blank" rel="noopener noreferrer">Shop now <Icon name="arrow" size={16}/></a><button type="button" onClick={onAskMuse}>Ask Muse</button></div>}
    </section>
    <section className="places-card" aria-label="Parked car">
      <div className="places-card-heading"><span className="places-icon"><Icon name="pin" size={23}/></span><div><h2>Parked car</h2><p>{parking ? `Saved ${new Date(parking.savedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}` : "Save where you left your car"}</p></div></div>
      {parking ? <>
        <div className="places-coordinates"><strong>{parking.note || "Parking spot"}</strong><span>{parking.lat.toFixed(5)}, {parking.lon.toFixed(5)} · ±{Math.round(parking.accuracy)} m</span></div>
        {distance && <p className="places-distance" role="status"><Icon name="navigation" size={18}/>{distance} from your car · approximate straight-line distance</p>}
        <div className="places-actions"><button type="button" className="places-primary" onClick={() => void findParking()} disabled={finding}>{finding ? "Locating…" : "Find my car"}</button><button type="button" onClick={() => void saveParking()} disabled={finding}>Update spot</button></div>
        <label className="places-note-label">Parking note<input value={parkingNote} maxLength={80} onChange={(event) => setParkingNote(event.target.value)} onBlur={saveNote} placeholder="Level 3, space B12"/></label>
      </> : <>
        <p className="places-help">Your parking coordinates stay in this browser. Save a level or space number as a note.</p>
        <label className="places-note-label">Parking note<input value={parkingNote} maxLength={80} onChange={(event) => setParkingNote(event.target.value)} placeholder="Level 3, space B12"/></label>
        <button type="button" className="places-primary places-full" onClick={() => void saveParking()} disabled={finding}>{finding ? "Locating…" : "Save current location"}</button>
      </>}
      {parkingError && <p className="places-error" role="alert">{parkingError}</p>}
    </section>

    <section className="places-card" aria-label="Repair shops">
      <div className="places-card-heading"><span className="places-icon"><Icon name="status" size={23}/></span><div><h2>Repair shops</h2><p>Find a shop or keep one you trust</p></div></div>
      <a className="places-primary places-full places-link" href="https://maps.apple.com/?q=auto+repair" target="_blank" rel="noopener noreferrer">Find repair shops in Maps <Icon name="arrow" size={17}/></a>
      <div className="places-saved-heading"><h3>Saved shops</h3><button type="button" onClick={() => setAddingGarage((value) => !value)}>{addingGarage ? "Cancel" : "+ Add shop"}</button></div>
      {addingGarage && <form className="places-garage-form" onSubmit={addGarage}><input aria-label="Shop name" placeholder="Shop name" value={garageName} onChange={(event) => setGarageName(event.target.value)} maxLength={80} required/><input aria-label="Shop address" placeholder="Address (optional)" value={garageAddress} onChange={(event) => setGarageAddress(event.target.value)} maxLength={160}/><button className="places-primary" type="submit">Save shop</button></form>}
      {garages.length === 0 && !addingGarage && <p className="places-empty">No saved shops yet.</p>}
      {garages.map((garage) => <div className="places-garage" key={garage.id}><div><strong>{garage.name}</strong>{garage.address && <span>{garage.address}</span>}</div><button type="button" onClick={() => removeGarage(garage.id)} aria-label={`Remove ${garage.name}`}>Remove</button></div>)}
    </section>
    <p className="places-privacy">Parking and saved shops stay on this device. Map search opens only when you tap it.</p>
  </div>;
}
