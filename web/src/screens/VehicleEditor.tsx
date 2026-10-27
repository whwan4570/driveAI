import { useState, type FormEvent } from "react";
import { Icon } from "../components/Icons";
import { api, type Vehicle } from "../lib/api";

export function VehicleEditor({ vehicle, onSaved, onCancel }: {
  vehicle: Vehicle;
  onSaved: (updated: Vehicle) => void;
  onCancel: () => void;
}) {
  const [make, setMake] = useState(vehicle.make ?? "");
  const [model, setModel] = useState(vehicle.model ?? "");
  const [year, setYear] = useState(String(vehicle.year));
  const [trim, setTrim] = useState(vehicle.trim ?? "");
  const [nickname, setNickname] = useState(vehicle.nickname ?? "");
  const [exteriorColor, setExteriorColor] = useState(vehicle.exterior_color ?? "");
  const [odometer, setOdometer] = useState(vehicle.odometer_km === null ? "" : String(Math.round(vehicle.odometer_km / 1.609344)));
  const [unit, setUnit] = useState<"mi" | "km">("mi");
  const [odometerDate, setOdometerDate] = useState(vehicle.odometer_updated_at?.slice(0, 10) ?? "");
  const [region, setRegion] = useState(vehicle.region ?? "");
  const [weeklyMiles, setWeeklyMiles] = useState(vehicle.weekly_miles === null ? "" : String(vehicle.weekly_miles));
  const [highwayPercent, setHighwayPercent] = useState(vehicle.highway_percent === null ? "" : String(vehicle.highway_percent));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateVehicle(vehicle.vehicle_id, {
        year: Number(year), make: make.trim(), model: model.trim(), trim: trim.trim() || null,
        nickname: nickname.trim() || null, exterior_color: exteriorColor.trim(),
        odometer_km: Math.round(Number(odometer) * (unit === "mi" ? 1.609344 : 1)),
        odometer_updated_at: new Date(`${odometerDate}T12:00:00`).toISOString(),
        region: region.trim(), weekly_miles: Number(weeklyMiles), highway_percent: Number(highwayPercent),
      });
      onSaved(updated);
    } catch {
      setError("Could not save your vehicle. Check the entries and try again.");
    } finally {
      setSaving(false);
    }
  };

  return <div className="vehicle-editor">
    <div className="page-heading"><p className="eyebrow">MY VEHICLE</p><h1>Edit vehicle</h1><p>Keep your care suggestions grounded in current details.</p></div>
    <form className="setup-form" onSubmit={(event) => void save(event)}>
      <div className="review-fields"><label>Make<input value={make} onChange={(event) => setMake(event.target.value)} required maxLength={60}/></label><label>Model<input value={model} onChange={(event) => setModel(event.target.value)} required maxLength={60}/></label></div>
      <div className="review-fields"><label>Model year<input type="number" min="1981" max="2035" value={year} onChange={(event) => setYear(event.target.value)} required/></label><label>Trim <span className="optional">optional</span><input value={trim} onChange={(event) => setTrim(event.target.value)} maxLength={60}/></label></div>
      <label>Car nickname <span className="optional">optional</span><input value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={60} placeholder="e.g. Sunny"/></label>
      <label>Exterior color<input value={exteriorColor} onChange={(event) => setExteriorColor(event.target.value)} maxLength={40} placeholder="e.g. Lunar Silver Metallic" required/></label>
      <p className="form-help">Changing the vehicle or paint color creates a new image automatically.</p>
      <div className="review-fields"><label>Odometer<input type="number" min="0" step="1" value={odometer} onChange={(event) => setOdometer(event.target.value)} required/></label><label>Unit<select value={unit} onChange={(event) => setUnit(event.target.value as "mi" | "km")}><option value="mi">Miles</option><option value="km">Kilometers</option></select></label></div>
      <label>Odometer reading date<input type="date" value={odometerDate} onChange={(event) => setOdometerDate(event.target.value)} required/></label>
      <label>City or region<input value={region} onChange={(event) => setRegion(event.target.value)} required maxLength={120}/></label>
      <div className="review-fields"><label>Typical miles / week<input type="number" min="0" max="3000" step="1" value={weeklyMiles} onChange={(event) => setWeeklyMiles(event.target.value)} required/></label><label>Highway driving %<input type="number" min="0" max="100" step="1" value={highwayPercent} onChange={(event) => setHighwayPercent(event.target.value)} required/></label></div>
      <p className="form-help"><Icon name="shield" size={16}/>Care suggestions use your saved estimates and confirmed records.</p>
      {error && <div className="inline-error" role="alert">{error}</div>}
      <button className="primary action-button" type="submit" disabled={saving}>{saving ? "Saving…" : "Save vehicle"}</button>
      <button className="secondary action-button" type="button" onClick={onCancel} disabled={saving}>Cancel</button>
    </form>
  </div>;
}
