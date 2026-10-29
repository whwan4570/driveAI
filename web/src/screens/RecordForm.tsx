import { useState, type FormEvent } from "react";
import { api, type Vehicle } from "../lib/api";
import { photoFromFile } from "../lib/photos";
import { MAINTENANCE_LABELS, SERVICE_COMPONENTS } from "../lib/serviceIntervals";

type Component = "washer_fluid" | "tires" | "engine_oil" | "brake_pads" | "cabin_filter" | "engine_air_filter";
type EventType = "inspection" | "refill" | "rotation" | "replacement";

export function RecordForm({ vehicle, initialComponent, onSaved, onCancel }: {
  vehicle: Vehicle;
  initialComponent: Component;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [component, setComponent] = useState<Component>(initialComponent);
  const [eventType, setEventType] = useState<EventType>("inspection");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [odometer, setOdometer] = useState(vehicle.odometer_km === null ? "" : String(Math.round(vehicle.odometer_km / 1.609344)));
  const [notes, setNotes] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!confirmed) { setError("Confirm that you completed this action."); return; }
    setSaving(true);
    setError(null);
    try {
      await api.addRecord({
        vehicle_id: vehicle.vehicle_id,
        component,
        event_type: eventType,
        completed_at: new Date(`${date}T12:00:00`).toISOString(),
        ...(odometer.trim() ? { odometer_km: Math.round(Number(odometer) * 1.609344) } : {}),
        notes: notes.trim() || undefined,
        photo_data_url: photo || undefined,
        user_confirmed: true,
      });
      onSaved();
    } catch {
      setError("Could not save this record. Check the details and try again.");
    } finally {
      setSaving(false);
    }
  };

  return <form className="record-form" onSubmit={(event) => void save(event)}>
    <div className="record-form-heading"><h2>Add a maintenance record</h2><button type="button" onClick={onCancel} aria-label="Close record form">×</button></div>
    <label>Component<select value={component} onChange={(event) => { const next = event.target.value as Component; setComponent(next); setEventType("inspection"); }}><option value="washer_fluid">Washer fluid</option>{SERVICE_COMPONENTS.map(({ id }) => <option key={id} value={id}>{MAINTENANCE_LABELS[id]}</option>)}</select></label>
    <label>Completed action<select value={eventType} onChange={(event) => setEventType(event.target.value as EventType)}><option value="inspection">Inspection</option>{component === "washer_fluid" ? <option value="refill">Fluid refill</option> : <>{component === "tires" && <option value="rotation">Rotation</option>}<option value="replacement">Replacement</option></>}</select></label>
    <div className="review-fields"><label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required/></label><label>Odometer (mi) <span className="optional">optional</span><input type="number" min="0" step="1" value={odometer} onChange={(event) => setOdometer(event.target.value)}/></label></div>
    <label>Notes <span className="optional">optional</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} placeholder="What did you inspect or do?"/></label>
    <label>Photo <span className="optional">optional</span><input type="file" accept="image/*" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; try { setPhoto(`data:image/jpeg;base64,${await photoFromFile(file)}`); setError(null); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not read photo."); } }}/></label>
    {photo && <img className="record-photo-preview" src={photo} alt="Maintenance record preview"/>}
    <label className="record-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} required/><span>I completed this action and want to save it to my car history.</span></label>
    {error && <div className="inline-error" role="alert">{error}</div>}
    <button className="primary action-button" type="submit" disabled={saving}>{saving ? "Saving…" : "Save record"}</button>
  </form>;
}
