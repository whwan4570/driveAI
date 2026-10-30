import { useRef, useState, type FormEvent } from "react";
import { api, type InspectionResult, type Vehicle } from "../lib/api";
import { photoFromFile } from "../lib/photos";

export function TireInspection({ vehicle, onSaved, onCancel }: { vehicle: Vehicle; onSaved: () => void; onCancel: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<InspectionResult | null>(null);
  const [measuredTread, setMeasuredTread] = useState("");
  const [measuredPressure, setMeasuredPressure] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setAnalysis(null);
    try {
      const data = await photoFromFile(file);
      setPhoto(`data:image/jpeg;base64,${data}`);
      setAnalysis(await api.analyzeInspection(vehicle.vehicle_id, { component: "tires", photo_type: "tire", jpeg_base64: data }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not analyze the tire photo.");
    } finally { setBusy(false); }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!confirmed) { setError("Confirm that you inspected the tire before saving."); return; }
    setBusy(true);
    setError(null);
    const details = [
      measuredTread ? `User-measured tread depth: ${measuredTread} mm` : null,
      measuredPressure ? `User-measured tire pressure: ${measuredPressure} psi` : null,
      notes.trim() || null,
    ].filter(Boolean).join(". ");
    try {
      await api.addRecord({ vehicle_id: vehicle.vehicle_id, component: "tires", event_type: "inspection", completed_at: new Date().toISOString(), odometer_km: vehicle.odometer_km ?? undefined, notes: details || undefined, photo_data_url: photo || undefined, user_confirmed: true });
      onSaved();
    } catch { setError("Could not save the inspection. Check your connection and try again."); }
    finally { setBusy(false); }
  };

  return <form className="tire-inspection k-form k-sheet" onSubmit={(event) => void save(event)}>
    <div className="record-form-heading"><h2>Tire inspection</h2><button type="button" onClick={onCancel} aria-label="Close tire inspection">×</button></div>
    <p>Take a tire photo to check for visible issues. A photo cannot measure tread depth or pressure.</p>
    <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden onChange={(event) => void analyze(event.target.files?.[0])}/>
    <button type="button" className="tire-photo-action" onClick={() => inputRef.current?.click()} disabled={busy}>{photo ? "Retake tire photo" : "Take or upload tire photo"}</button>
    {photo && <img className="record-photo-preview" src={photo} alt="Tire inspection preview"/>}
    {busy && !confirmed && <div className="inspection-message">Analyzing the photo…</div>}
    {analysis && <div className={`inspection-message ${analysis.status}`}>{analysis.observation}<small>{analysis.source === "meta_vision" ? "AI visual observation, not a physical measurement" : "AI analysis unavailable"}</small></div>}
    <div className="review-fields"><label>Measured tread (mm) <span className="optional">optional</span><input type="number" min="0" max="30" step="0.1" value={measuredTread} onChange={(event) => setMeasuredTread(event.target.value)} placeholder="From a tread gauge"/></label><label>Measured pressure (psi) <span className="optional">optional</span><input type="number" min="0" max="100" step="0.1" value={measuredPressure} onChange={(event) => setMeasuredPressure(event.target.value)} placeholder="From a pressure gauge"/></label></div>
    <label>Notes <span className="optional">optional</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} placeholder="What did you observe?"/></label>
    <label className="record-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} required/><span>I inspected the tire and want to save this record.</span></label>
    {error && <div className="inline-error" role="alert">{error}</div>}
    <button className="primary action-button" type="submit" disabled={busy}>{busy ? "Working…" : "Save tire inspection"}</button>
  </form>;
}
