import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "../components/Icons";
import { VehiclePicker } from "../components/VehiclePicker";
import { api, type DocumentType, type VehicleScanResult, type VehicleSpecView } from "../lib/api";
import { FULL_FRAME, grabJpeg, openRearCamera } from "../lib/camera";

type ScanMode = "vin" | "exterior" | "document";
const DOCUMENTS: { id: DocumentType; label: string }[] = [
  { id: "buyers_guide", label: "Buyers Guide" },
  { id: "odometer_disclosure", label: "Odometer Disclosure Statement" },
  { id: "vehicle_history_report", label: "Vehicle History Report" },
  { id: "window_sticker", label: "Window / Monroney Sticker" },
];
type SpeechResult = { results: ArrayLike<ArrayLike<{ transcript: string }>> };
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  onresult: ((event: SpeechResult) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechCtor = new () => SpeechRecognitionLike;

export function Setup({ onRegistered }: { onRegistered: (vehicleId: string) => void }) {
  const [specs, setSpecs] = useState<VehicleSpecView[]>([]);
  const [specId, setSpecId] = useState("");
  const [year, setYear] = useState<number | "">("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [trim, setTrim] = useState("");
  const [nickname, setNickname] = useState("");
  const [exteriorColor, setExteriorColor] = useState("");
  const [odometer, setOdometer] = useState("");
  const [odometerUnit, setOdometerUnit] = useState<"mi" | "km">("mi");
  const [odometerDate, setOdometerDate] = useState("");
  const [region, setRegion] = useState("");
  const [weeklyMiles, setWeeklyMiles] = useState("");
  const [highwayPercent, setHighwayPercent] = useState("");
  const [mode, setMode] = useState<ScanMode>("vin");
  const [documentType, setDocumentType] = useState<DocumentType>("buyers_guide");
  const [documentName, setDocumentName] = useState("");
  const [readingDocument, setReadingDocument] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<VehicleScanResult | null>(null);
  const [manual, setManual] = useState(false);
  const [recognitionAvailable, setRecognitionAvailable] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const speechRef = useRef<SpeechRecognitionLike | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.vehicleSpecs()
      .then((list) => {
        setSpecs(list);
        if (list[0]) setSpecId(list[0].spec_id);
      })
      .catch(() => setError("Could not connect to the server. Start it and try again."));
    api.recognitionStatus().then(({ available }) => setRecognitionAvailable(available)).catch(() => setRecognitionAvailable(false));
    return () => speechRef.current?.stop();
  }, []);

  useEffect(() => {
    if (!cameraOpen || !videoRef.current) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    setCameraReady(false);
    openRearCamera(videoRef.current)
      .then((opened) => {
        if (stopped) opened.getTracks().forEach((track) => track.stop());
        else { stream = opened; setCameraReady(true); }
      })
      .catch(() => { if (!stopped) { setError("Camera access failed. Check browser permission or enter your car manually."); setCameraOpen(false); } });
    return () => { stopped = true; stream?.getTracks().forEach((track) => track.stop()); };
  }, [cameraOpen]);

  const identify = async () => {
    if (mode === "document" || !videoRef.current || !cameraReady || scanning) return;
    setScanning(true);
    setError(null);
    try {
      const jpegBase64 = grabJpeg(videoRef.current, FULL_FRAME, 1600, 0.82);
      const result = await api.recognizeVehicle({ mode, jpeg_base64: jpegBase64 });
      if (result.status !== "recognized") { setError(result.message); return; }
      setScanResult(result);
      setMake(result.make ?? "");
      setModel(result.model ?? "");
      setTrim(result.trim ?? "");
      setYear(result.year ?? "");
      setExteriorColor(result.exterior_color ?? "");
      setCameraOpen(false);
    } catch {
      setError("The scan could not be completed. Try again or enter your car manually.");
    } finally {
      setScanning(false);
    }
  };

  const readDocument = async (file: File | undefined) => {
    if (!file || readingDocument) return;
    if (file.size > 8_000_000) { setError("Choose a PDF or image smaller than 8 MB."); return; }
    const suffix = file.name.toLowerCase();
    const mime = file.type === "application/pdf" || suffix.endsWith(".pdf") ? "application/pdf" : file.type === "image/jpeg" || /\.jpe?g$/.test(suffix) ? "image/jpeg" : file.type === "image/png" || suffix.endsWith(".png") ? "image/png" : null;
    if (!mime) { setError("Choose a PDF, JPEG, or PNG file."); return; }
    setReadingDocument(true);
    setError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsDataURL(file);
      });
      const result = await api.recognizeDocument({ document_type: documentType, mime_type: mime, data_base64: dataUrl.split(",", 2)[1] });
      if (result.status !== "recognized") { setError(result.message); return; }
      setDocumentName(file.name);
      setScanResult(result);
      setMake(result.make ?? "");
      setModel(result.model ?? "");
      setTrim(result.trim ?? "");
      setYear(result.year ?? "");
      setExteriorColor(result.exterior_color ?? "");
    } catch {
      setError("The document could not be read. Try another image or enter your car manually.");
    } finally {
      setReadingDocument(false);
    }
  };

  const register = async () => {
    if (!specId || saving) return;
    const spec = specs.find((item) => item.spec_id === specId);
    const mileage = Number(odometer);
    const weekly = Number(weeklyMiles);
    const highway = Number(highwayPercent);
    if (typeof year !== "number" || !spec || year < spec.years[0] || year > spec.years[1] ||
      !make.trim() || !model.trim() || !exteriorColor.trim() || !odometer.trim() || !Number.isFinite(mileage) || mileage < 0 ||
      !odometerDate || !region.trim() || !weeklyMiles.trim() || !Number.isFinite(weekly) || weekly < 0 || weekly > 3000 ||
      !highwayPercent.trim() || !Number.isInteger(highway) || highway < 0 || highway > 100) {
      setError("Add your vehicle, exterior color, odometer, region, and driving profile before continuing.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const vehicle = await api.createVehicle({
        spec_id: specId,
        year,
        make: make.trim(), model: model.trim(), trim: trim.trim() || undefined,
        nickname: nickname.trim() || undefined, exterior_color: exteriorColor.trim(),
        odometer_km: Math.round(mileage * (odometerUnit === "mi" ? 1.609344 : 1)),
        odometer_updated_at: new Date(`${odometerDate}T12:00:00`).toISOString(),
        region: region.trim(), weekly_miles: weekly, highway_percent: highway,
        profile_source: scanResult?.source === "document" ? "document" : scanResult ? "scan" : "manual",
      });
      onRegistered(vehicle.vehicle_id);
    } catch {
      setError("Vehicle details could not be saved. Check the year and try again.");
      setSaving(false);
    }
  };

  const submit = (event: FormEvent) => { event.preventDefault(); void register(); };

  const confirmByVoice = () => {
    const browser = window as typeof window & { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
    const Ctor = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Ctor) { setError("Voice confirmation is not supported in this browser. Use Confirm vehicle below."); return; }
    speechRef.current?.stop();
    const speech = new Ctor();
    speechRef.current = speech;
    speech.lang = "en-US";
    speech.interimResults = false;
    speech.onresult = (event) => {
      const heard = event.results[0]?.[0]?.transcript?.trim().toLowerCase() ?? "";
      if (/\b(yes|correct|that's my car|that is my car|confirm)\b/.test(heard)) void register();
      else setError(`Heard “${heard || "nothing"}”. Say “Yes, that's my car” or use Confirm vehicle.`);
    };
    speech.onerror = () => { setListening(false); setError("Voice confirmation was unavailable. Use Confirm vehicle below."); };
    speech.onend = () => setListening(false);
    try { speech.start(); setListening(true); setError(null); }
    catch { setError("Voice confirmation was unavailable. Use Confirm vehicle below."); }
  };

  const showManual = () => {
    setCameraOpen(false);
    setScanResult(null);
    setExteriorColor("");
    setManual(true);
    setError(null);
  };

  return <div className="app-shell"><main className="screen setup-screen">
    <header className="topbar"><div className="brand"><span className="brand-mark"><Icon name="car" size={27}/></span><span>Carmori</span></div></header>
    <div className="setup-hero scan-hero"><span className="setup-hero-icon"><Icon name="spark" size={34}/></span><p className="eyebrow">YOUR DRIVE, REMEMBERED</p><h1>Let's meet your car</h1><p>Scan your car or use a document from when you bought it.</p></div>

    {!manual && !scanResult && <section className="scan-panel">
      <div className="scan-panel-heading"><span className="scan-panel-icon"><Icon name="camera" size={23}/></span><div><h2>Identify your vehicle</h2><p>Choose the source you have nearby</p></div></div>
      <div className="scan-modes three" role="group" aria-label="Scan method">
        <button type="button" className={mode === "vin" ? "selected" : ""} onClick={() => { setMode("vin"); setError(null); }}>VIN plate</button>
        <button type="button" className={mode === "exterior" ? "selected" : ""} onClick={() => { setMode("exterior"); setError(null); }}>Car exterior</button>
        <button type="button" className={mode === "document" ? "selected" : ""} onClick={() => { setMode("document"); setCameraOpen(false); setError(null); }}>Documents</button>
      </div>
      {mode === "document" ? <div className="document-source">
        <p className="document-caption">PURCHASE PAPERWORK</p>
        <div className="document-options" role="group" aria-label="Document type">{DOCUMENTS.map((item) => <button key={item.id} type="button" className={documentType === item.id ? "selected" : ""} onClick={() => setDocumentType(item.id)}>{item.label}</button>)}</div>
        <div className="document-upload-illustration"><Icon name="history" size={39}/><strong>Find your car in the paperwork</strong><span>Photo, JPG, PNG or PDF · up to 8 MB</span></div>
        <p className="scan-help">The file goes to Meta for one-time reading. Carmori saves confirmed vehicle details, not the document.</p>
        <input ref={photoInputRef} type="file" accept="image/jpeg,image/png" capture="environment" hidden onChange={(event) => { void readDocument(event.target.files?.[0]); event.target.value = ""; }}/>
        <input ref={fileInputRef} type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" hidden onChange={(event) => { void readDocument(event.target.files?.[0]); event.target.value = ""; }}/>
        <div className="document-actions"><button className="primary action-button" type="button" disabled={readingDocument || recognitionAvailable === false} onClick={() => photoInputRef.current?.click()}><Icon name="camera" size={18}/>{readingDocument ? "Reading document…" : "Take photo"}</button><button className="secondary action-button" type="button" disabled={readingDocument || recognitionAvailable === false} onClick={() => fileInputRef.current?.click()}><Icon name="history" size={18}/>Upload file</button></div>
      </div> : <>
        <div className="scan-camera">
          {cameraOpen ? <video ref={videoRef} playsInline muted aria-label="Live camera preview" /> : <div className="scan-placeholder"><Icon name={mode === "vin" ? "inspect" : "car"} size={52}/><strong>{mode === "vin" ? "Find the VIN plate" : "Frame your car"}</strong><span>{mode === "vin" ? "Usually at the base of the windshield" : "Show the front or rear with the badge visible"}</span></div>}
          <span className="scan-corner top-left"/><span className="scan-corner top-right"/><span className="scan-corner bottom-left"/><span className="scan-corner bottom-right"/>
        </div>
        <p className="scan-help">{mode === "vin" ? "The image goes to Meta for reading and the VIN to NHTSA for decoding. Carmori does not save the VIN." : "An exterior scan suggests make and model. You will enter the model year."}</p>
      </>}
      {recognitionAvailable === false && <p className="scan-unavailable"><Icon name="shield" size={15}/>Live recognition needs a Meta API key. Manual entry is available.</p>}
      {mode !== "document" && (!cameraOpen ? <button className="primary action-button" type="button" onClick={() => { setCameraOpen(true); setError(null); }}><Icon name="camera" size={19}/>Open camera</button>
        : <button className="primary action-button" type="button" onClick={() => void identify()} disabled={!cameraReady || scanning || recognitionAvailable === false}>{scanning ? "Identifying…" : cameraReady ? "Identify vehicle" : "Starting camera…"}<Icon name="arrow" size={18}/></button>)}
      <button className="text-button" type="button" onClick={showManual}>Enter vehicle details instead <Icon name="chevron" size={17}/></button>
    </section>}

    {(scanResult || manual) && <form className="setup-form vehicle-review" onSubmit={submit}>
      {scanResult ? <><span className="result-kicker"><Icon name="check" size={16}/>{scanResult.source === "vin" ? "VIN decoded" : scanResult.source === "document" ? "Document read" : "Visual match"}</span><h2>Is this your car?</h2><p className="review-note">{scanResult.message}{scanResult.vin_last4 ? ` VIN ending in ${scanResult.vin_last4}.` : ""}{scanResult.source === "document" && documentName ? ` Source: ${documentName}.` : ""}</p></>
        : <><h2>Vehicle details</h2><p className="review-note">Add your car and driving profile to personalize care suggestions.</p></>}
      <VehiclePicker make={make} model={model} year={typeof year === "number" ? year : null} onChange={(next) => { setMake(next.make); setModel(next.model); }}/>
      {specs.length > 1 && <label>Vehicle guide<select value={specId} onChange={(e) => setSpecId(e.target.value)}>{specs.map((s) => <option key={s.spec_id} value={s.spec_id}>{s.display_name}</option>)}</select></label>}
      <div className="review-fields"><label>Model year<input type="number" min={specs.find((item) => item.spec_id === specId)?.years[0] ?? 1981} max={specs.find((item) => item.spec_id === specId)?.years[1] ?? 2035} value={year} onChange={(e) => setYear(e.target.value ? Number(e.target.value) : "")} placeholder="Year" required/></label><label>Trim <span className="optional">optional</span><input value={trim} onChange={(e) => setTrim(e.target.value)} maxLength={60} placeholder="e.g. EX"/></label></div>
      <label>Car nickname <span className="optional">optional</span><input value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={60} placeholder="e.g. Sunny"/></label>
      <label>Exterior color<input value={exteriorColor} onChange={(e) => setExteriorColor(e.target.value)} maxLength={40} placeholder="e.g. Lunar Silver Metallic" required/></label>
      <p className="review-note">Carmori creates your vehicle image automatically from these confirmed details.</p>
      <div className="review-fields"><label>Odometer<input type="number" min="0" step="1" value={odometer} onChange={(e) => setOdometer(e.target.value)} placeholder="Current reading" required/></label><label>Unit<select value={odometerUnit} onChange={(e) => setOdometerUnit(e.target.value as "mi" | "km")}><option value="mi">Miles</option><option value="km">Kilometers</option></select></label></div>
      <label>Odometer reading date<input type="date" value={odometerDate} onChange={(e) => setOdometerDate(e.target.value)} required/></label>
      <label>City or region<input value={region} onChange={(e) => setRegion(e.target.value)} maxLength={120} placeholder="e.g. San Francisco, CA" required/></label>
      <div className="review-fields"><label>Typical miles / week<input type="number" min="0" max="3000" step="1" value={weeklyMiles} onChange={(e) => setWeeklyMiles(e.target.value)} placeholder="Your estimate" required/></label><label>Highway driving %<input type="number" min="0" max="100" step="1" value={highwayPercent} onChange={(e) => setHighwayPercent(e.target.value)} placeholder="0–100" required/></label></div>
      <p className="form-help"><Icon name="shield" size={16}/>Estimates come from your entries. You can edit them later.</p>
      {scanResult && <button className="secondary action-button" type="button" onClick={confirmByVoice} disabled={listening || saving || !year || !make.trim() || !model.trim() || !exteriorColor.trim() || !odometer || !region.trim() || !weeklyMiles || !highwayPercent || !odometerDate}><Icon name="mic" size={18}/>{listening ? "Listening for confirmation…" : "Confirm by voice"}</button>}
      <button className="primary action-button" type="submit" disabled={!specId || saving}>{saving ? "Saving…" : scanResult ? "Confirm vehicle" : "Get started"}<Icon name="arrow" size={18}/></button>
      <button className="text-button" type="button" onClick={() => { setScanResult(null); setManual(false); setError(null); }}>Scan {scanResult ? "again" : "my car"} <Icon name="chevron" size={17}/></button>
    </form>}
    {error && <div className="inline-error" role="alert">{error}</div>}
  </main></div>;
}
