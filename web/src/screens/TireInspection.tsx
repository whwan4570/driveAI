import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "../components/Icons";
import { api, type InspectionResult, type Vehicle } from "../lib/api";
import { FULL_FRAME, grabJpeg, openRearCamera } from "../lib/camera";
import { photoFromFile } from "../lib/photos";

// Opens straight into the camera: frame the tire, take the shot, then review and save on the same view.
export function TireInspection({ vehicle, onSaved, onCancel }: { vehicle: Vehicle; onSaved: () => void; onCancel: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraFailed, setCameraFailed] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<InspectionResult | null>(null);
  const [showReadings, setShowReadings] = useState(false);
  const [measuredTread, setMeasuredTread] = useState("");
  const [measuredPressure, setMeasuredPressure] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (photo || !videoRef.current) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    setCameraReady(false);
    openRearCamera(videoRef.current)
      .then((opened) => { if (stopped) opened.getTracks().forEach((track) => track.stop()); else { stream = opened; setCameraReady(true); } })
      .catch(() => { if (!stopped) setCameraFailed(true); });
    return () => { stopped = true; stream?.getTracks().forEach((track) => track.stop()); };
  }, [photo]);

  const analyze = async (data: string) => {
    setPhoto(`data:image/jpeg;base64,${data}`);
    setBusy(true);
    setError(null);
    setAnalysis(null);
    try {
      setAnalysis(await api.analyzeInspection(vehicle.vehicle_id, { component: "tires", photo_type: "tire", jpeg_base64: data }));
    } catch {
      setError("Could not analyze the tire photo. You can still save what you saw.");
    } finally { setBusy(false); }
  };

  const shoot = () => {
    if (!videoRef.current?.videoWidth) return;
    void analyze(grabJpeg(videoRef.current, FULL_FRAME, 1600, 0.82));
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    try { await analyze(await photoFromFile(file)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not read the photo."); }
  };

  const retake = () => {
    setPhoto(null); setAnalysis(null); setConfirmed(false); setError(null);
    if (cameraFailed) inputRef.current?.click();
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

  const box = analysis?.status === "located" ? analysis.box : null;

  return <div className="arw arw-overlay" role="dialog" aria-modal="true" aria-label="Tire inspection">
    <div className="arw-viewport">
      {photo ? <div className="arw-still">
        <img src={photo} alt="Tire photo being inspected"/>
        {box && <span className="arw-box" style={{ left: `${box[0] * 100}%`, top: `${box[1] * 100}%`, width: `${(box[2] - box[0]) * 100}%`, height: `${(box[3] - box[1]) * 100}%` }}/>}
      </div> : <>
        <video ref={videoRef} playsInline muted/>
        {!cameraFailed && <div className="arw-tire-guide" aria-hidden="true"><span>Fit the whole tire in the circle</span></div>}
        {cameraFailed && <p className="arw-no-camera">Camera unavailable. Upload a tire photo instead.</p>}
      </>}
    </div>

    <header className="arw-top">
      <button type="button" className="arw-icon" aria-label="Close tire inspection" onClick={onCancel}><Icon name="close" size={22}/></button>
      <div className="arw-progress"><strong>{photo ? "2/2 · Review" : "1/2 · Take the photo"}</strong>
        <div className="arw-progress-track">{[1, 2].map((n) => <i key={n} className={n === 1 || photo ? "filled" : ""}/>)}</div>
      </div>
      <span className="arw-live"><span/>LIVE</span>
    </header>

    <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ""; }}/>

    <div className="arw-bottom">
      {error && <div className="arw-error" role="alert">{error}</div>}
      {!photo ? <section className="arw-card">
        <span className="arw-status"><span className="arw-dot"/>Tire visual check</span>
        <h1>Show the tread and sidewall</h1>
        <p>A photo shows visible issues only. It cannot measure tread depth or pressure.</p>
        <div className="arw-actions">
          <button type="button" className="arw-secondary" onClick={() => inputRef.current?.click()}><Icon name="file" size={18}/>Upload</button>
          <button type="button" className="arw-primary" onClick={shoot} disabled={!cameraReady}><Icon name="camera" size={18}/>Take photo</button>
        </div>
      </section> : <form className="arw-card k-form" onSubmit={(event) => void save(event)}>
        <span className="arw-status"><span className={`arw-dot${busy && !analysis ? " pulsing" : ""}`}/>{busy && !analysis ? "Looking at the tire…" : "Review and save"}</span>
        {analysis && <p className={`arw-note ${analysis.status}`}>{analysis.observation}<small>{analysis.source === "meta_vision" ? " AI visual observation, not a measurement." : " AI analysis unavailable."}</small></p>}
        <button type="button" className="arw-link" onClick={() => setShowReadings((open) => !open)} aria-expanded={showReadings}>{showReadings ? "Hide gauge readings" : "Add gauge readings"}<Icon name="chevron" size={16}/></button>
        {showReadings && <>
          <div className="review-fields"><label>Tread (mm)<input type="number" min="0" max="30" step="0.1" value={measuredTread} onChange={(event) => setMeasuredTread(event.target.value)} placeholder="Tread gauge"/></label><label>Pressure (psi)<input type="number" min="0" max="100" step="0.1" value={measuredPressure} onChange={(event) => setMeasuredPressure(event.target.value)} placeholder="Pressure gauge"/></label></div>
          <label>Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} placeholder="What did you observe?"/></label>
        </>}
        <label className="record-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}/><span>I inspected the tire and want to save this.</span></label>
        <div className="arw-actions">
          <button type="button" className="arw-secondary" onClick={retake} disabled={busy}>Retake</button>
          <button type="submit" className="arw-primary" disabled={busy || !confirmed}>{busy && analysis ? "Saving…" : "Save"}</button>
        </div>
      </form>}
    </div>
  </div>;
}
