import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon, type IconName } from "../components/Icons";
import { VehiclePicker } from "../components/VehiclePicker";
import { VehicleConfigurationFields, inferredCivicBodyStyle, isCivic, type BodyStyle } from "../components/VehicleConfigurationFields";
import { api, type DocumentType, type VehicleScanResult, type VehicleSpecView } from "../lib/api";
import { FULL_FRAME, grabJpeg, openRearCamera } from "../lib/camera";
import { todayLocalISO } from "../lib/vehicleDates";

type ScanMode = "vin" | "exterior" | "document";
const METHODS: { id: ScanMode; icon: IconName; title: string; detail: string; lead: string }[] = [
  { id: "vin", icon: "inspect", title: "Scan the VIN plate", detail: "Fastest · reads year, make and model", lead: "It's on the dashboard at the base of the windshield, driver's side." },
  { id: "exterior", icon: "car", title: "Photograph your car", detail: "Suggests make and model", lead: "Show the front or rear with the badge visible. You will add the model year." },
  { id: "document", icon: "file", title: "Upload a document", detail: "Bill of sale, buyers guide, or window sticker", lead: "Use a photo, JPG, PNG or PDF up to 8 MB." },
];
const DOCUMENTS: { id: DocumentType; label: string }[] = [
  { id: "bill_of_sale", label: "Bill of Sale / Purchase Agreement" },
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
  const [bodyStyle, setBodyStyle] = useState<BodyStyle | "">("");
  const [nickname, setNickname] = useState("");
  const [purchasedOn, setPurchasedOn] = useState("");
  const [firstDriveOn, setFirstDriveOn] = useState("");
  const [majorIssueFreeConfirmed, setMajorIssueFreeConfirmed] = useState(false);
  const [exteriorColor, setExteriorColor] = useState("");
  const [odometer, setOdometer] = useState("");
  const [odometerUnit, setOdometerUnit] = useState<"mi" | "km">("mi");
  const [odometerDate, setOdometerDate] = useState("");
  const [mode, setMode] = useState<ScanMode | null>(null);
  const [documentType, setDocumentType] = useState<DocumentType>("bill_of_sale");
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
    if (mode === null || mode === "document" || !videoRef.current || !cameraReady || scanning) return;
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
      setBodyStyle(inferredCivicBodyStyle(result.model ?? "", result.trim ?? ""));
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
      setBodyStyle(inferredCivicBodyStyle(result.model ?? "", result.trim ?? ""));
      setYear(result.year ?? "");
      setExteriorColor(result.exterior_color ?? "");
      if (result.sale_date) setPurchasedOn(result.sale_date);
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
    if (typeof year !== "number" || !spec || year < spec.years[0] || year > spec.years[1] ||
      !make.trim() || !model.trim() || !exteriorColor.trim() || !odometer.trim() || !Number.isFinite(mileage) || mileage < 0 ||
      !odometerDate) {
      setError("Add your vehicle, exterior color, and odometer before continuing.");
      return;
    }
    if ((firstDriveOn && purchasedOn && firstDriveOn < purchasedOn) ||
        (purchasedOn && purchasedOn > todayLocalISO()) ||
        (firstDriveOn && firstDriveOn > todayLocalISO())) {
      setError("Check the purchase and first-drive dates before continuing.");
      return;
    }
    if (isCivic(make, model) && !bodyStyle) { setError("Select your Civic body style."); return; }
    if (/type r/i.test(`${model} ${trim}`) && bodyStyle !== "hatchback") { setError("Type R uses the Hatchback body style."); return; }
    setSaving(true);
    setError(null);
    try {
      const vehicle = await api.createVehicle({
        spec_id: specId,
        year,
        make: make.trim(), model: model.trim(), trim: trim.trim() || undefined,
        body_style: isCivic(make, model) ? bodyStyle || null : null,
        nickname: nickname.trim() || undefined, exterior_color: exteriorColor.trim(),
        purchased_on: purchasedOn || null, first_drive_on: firstDriveOn || null,
        major_issue_free_confirmed: majorIssueFreeConfirmed,
        odometer_km: Math.round(mileage * (odometerUnit === "mi" ? 1.609344 : 1)),
        odometer_updated_at: new Date(`${odometerDate}T12:00:00`).toISOString(),
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

  return <div className="app-shell"><main className={`screen setup-screen${!manual && !scanResult ? " is-k" : ""}${!manual && !scanResult && mode !== null ? " has-k-cta" : ""}`}>
    <header className="topbar"><div className="brand"><span className="brand-mark"><Icon name="car" size={27}/></span><span>Carmori</span></div></header>
    {!manual && !scanResult && mode === null && <div className="k-page">
      <header className="k-hero"><h1 className="k-title">Add your car</h1><p className="k-lead">Pick how you want to start.</p></header>
      <section className="k-block is-list" aria-label="Ways to add your car">
        {METHODS.map((item) => <button className="k-row" type="button" key={item.id} disabled={recognitionAvailable === false} onClick={() => { setMode(item.id); setError(null); }}>
          <span className="k-row-art"><Icon name={item.icon} size={22}/></span>
          <span className="k-row-main"><strong>{item.title}</strong><small>{recognitionAvailable === false ? "Needs a Meta API key" : item.detail}</small></span>
          <Icon className="k-row-trail" name="chevron" size={18}/>
        </button>)}
        <button className="k-row" type="button" onClick={showManual}>
          <span className="k-row-art"><Icon name="plus" size={22}/></span>
          <span className="k-row-main"><strong>Enter details yourself</strong><small>Year, make, model and odometer</small></span>
          <Icon className="k-row-trail" name="chevron" size={18}/>
        </button>
      </section>
      <p className="k-info"><Icon name="shield" size={16}/>Photos go to Meta for one-time reading. Carmori does not save the VIN or the document.</p>
    </div>}

    {!manual && !scanResult && mode !== null && <div className="k-page">
      <button className="k-back" type="button" onClick={() => { setMode(null); setCameraOpen(false); setError(null); }} aria-label="Back to ways to add your car"><Icon name="chevron" size={22}/></button>
      <header className="k-hero"><h1 className="k-title">{METHODS.find((item) => item.id === mode)?.title}</h1><p className="k-lead">{METHODS.find((item) => item.id === mode)?.lead}</p></header>
      {mode === "document" ? <section className="k-block" aria-label="Document type">
        <h2 className="k-h2">Which document?</h2>
        <div className="k-chips" role="radiogroup" aria-label="Document type">{DOCUMENTS.map((item) => <button key={item.id} type="button" role="radio" aria-checked={documentType === item.id} className={`k-chip${documentType === item.id ? " is-selected" : ""}`} onClick={() => setDocumentType(item.id)}>{item.label}</button>)}</div>
        <input ref={photoInputRef} type="file" accept="image/jpeg,image/png" capture="environment" hidden onChange={(event) => { void readDocument(event.target.files?.[0]); event.target.value = ""; }}/>
        <input ref={fileInputRef} type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" hidden onChange={(event) => { void readDocument(event.target.files?.[0]); event.target.value = ""; }}/>
      </section> : cameraOpen ? <section className="k-block" aria-label="Camera">
        <div className="k-camera"><video ref={videoRef} playsInline muted aria-label="Live camera preview"/></div>
      </section> : null}
      <p className="k-info"><Icon name="shield" size={16}/>{mode === "vin" ? "The photo goes to Meta for reading and the VIN to NHTSA for decoding. Carmori does not save the VIN." : mode === "document" ? "The file goes to Meta for one-time reading. Carmori saves confirmed vehicle details, not the document." : "The photo goes to Meta for one-time reading."}</p>
      <div className="k-cta">
        {mode === "document" ? <>
          <button className="k-btn secondary" type="button" disabled={readingDocument} onClick={() => fileInputRef.current?.click()}>Choose file</button>
          <button className="k-btn primary" type="button" disabled={readingDocument} onClick={() => photoInputRef.current?.click()}>{readingDocument ? "Reading document…" : "Take photo"}</button>
        </> : !cameraOpen ? <button className="k-btn primary" type="button" onClick={() => { setCameraOpen(true); setError(null); }}>{mode === "vin" ? "Scan VIN plate" : "Take photo"}</button>
          : <button className="k-btn primary" type="button" onClick={() => void identify()} disabled={!cameraReady || scanning}>{scanning ? "Identifying…" : cameraReady ? "Identify vehicle" : "Starting camera…"}</button>}
      </div>
    </div>}

    {(scanResult || manual) && <form className="setup-form vehicle-review" onSubmit={submit}>
      {scanResult ? <><span className="result-kicker"><Icon name="check" size={16}/>{scanResult.source === "vin" ? "VIN decoded" : scanResult.source === "document" ? "Document read" : "Visual match"}</span><h2>Is this your car?</h2><p className="review-note">{scanResult.message}{scanResult.vin_last4 ? ` VIN ending in ${scanResult.vin_last4}.` : ""}{scanResult.source === "document" && documentName ? ` Source: ${documentName}.` : ""}{scanResult.sale_date ? " Confirm the suggested sale date is when you bought this car." : ""}</p></>
        : <><h2>Vehicle details</h2><p className="review-note">Add your car to personalize care suggestions.</p></>}
      <VehiclePicker make={make} model={model} year={typeof year === "number" ? year : null} onChange={(next) => { setMake(next.make); setModel(next.model); setBodyStyle(inferredCivicBodyStyle(next.model)); setTrim(""); }}/>
      {specs.length > 1 && <label>Vehicle guide<select value={specId} onChange={(e) => setSpecId(e.target.value)}>{specs.map((s) => <option key={s.spec_id} value={s.spec_id}>{s.display_name}</option>)}</select></label>}
      <label>Model year<input type="number" min={specs.find((item) => item.spec_id === specId)?.years[0] ?? 1981} max={specs.find((item) => item.spec_id === specId)?.years[1] ?? 2035} value={year} onChange={(e) => setYear(e.target.value ? Number(e.target.value) : "")} placeholder="Year" required/></label>
      <VehicleConfigurationFields make={make} model={model} bodyStyle={bodyStyle} onBodyStyleChange={setBodyStyle} trim={trim} onTrimChange={setTrim}/>
      <label>Car nickname <span className="optional">optional</span><input value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={60} placeholder="e.g. Sunny"/></label>
      <div className="review-fields"><label>Purchase date <span className="optional">optional</span><input type="date" max={todayLocalISO()} value={purchasedOn} onChange={(e) => { setPurchasedOn(e.target.value); setMajorIssueFreeConfirmed(false); }}/></label><label>First drive date <span className="optional">optional</span><input type="date" min={purchasedOn || undefined} max={todayLocalISO()} value={firstDriveOn} onChange={(e) => setFirstDriveOn(e.target.value)}/></label></div>
      <p className="form-help">Don't know these dates? Leave them blank. Your count starts the day you add this car to Carmori.</p>
      <label className="relationship-confirm"><input type="checkbox" checked={majorIssueFreeConfirmed} onChange={(e) => setMajorIssueFreeConfirmed(e.target.checked)}/><span>No major issues since {purchasedOn ? "purchase" : "starting Carmori"}. This includes accidents, engine or transmission failures, brake or steering failures, and breakdowns requiring a tow. Routine maintenance is excluded.</span></label>
      <label>Exterior color<input value={exteriorColor} onChange={(e) => setExteriorColor(e.target.value)} maxLength={40} placeholder="e.g. Lunar Silver Metallic" required/></label>
      <p className="review-note">Carmori creates your vehicle image automatically from these confirmed details.</p>
      <div className="review-fields"><label>Odometer<input type="number" min="0" step="1" value={odometer} onChange={(e) => setOdometer(e.target.value)} placeholder="Current reading" required/></label><label>Unit<select value={odometerUnit} onChange={(e) => setOdometerUnit(e.target.value as "mi" | "km")}><option value="mi">Miles</option><option value="km">Kilometers</option></select></label></div>
      <label>Odometer reading date<input type="date" value={odometerDate} onChange={(e) => setOdometerDate(e.target.value)} required/></label>
      <p className="form-help"><Icon name="shield" size={16}/>Driving distance is tracked with GPS while location is on.</p>
      {scanResult && <button className="secondary action-button" type="button" onClick={confirmByVoice} disabled={listening || saving || !year || !make.trim() || !model.trim() || !exteriorColor.trim() || !odometer || !odometerDate}><Icon name="mic" size={18}/>{listening ? "Listening for confirmation…" : "Confirm by voice"}</button>}
      <button className="primary action-button" type="submit" disabled={!specId || saving}>{saving ? "Saving…" : scanResult ? "Confirm vehicle" : "Get started"}<Icon name="arrow" size={18}/></button>
      <button className="text-button" type="button" onClick={() => { setScanResult(null); setManual(false); setError(null); }}>Scan {scanResult ? "again" : "my car"} <Icon name="chevron" size={17}/></button>
    </form>}
    {error && <div className="inline-error" role="alert">{error}</div>}
  </main></div>;
}
