import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "./Icons";
import { api, type CareResponse, type MaintenanceRecord, type OwnerManualStatus, type Vehicle } from "../lib/api";
import { intervalRemaining, latestService, loadServiceIntervals, saveServiceInterval, SERVICE_COMPONENTS, type ServiceComponent, type ServiceInterval } from "../lib/serviceIntervals";
import { manufacturerSchedule } from "../lib/manufacturerSchedule";
import { SAMPLE_SERVICE_REMAINING } from "../lib/statusPreview";

type StatusComponent = ServiceComponent | "washer_fluid";
type Tone = "unknown" | "good" | "soon" | "due";
const STATUS_COMPONENTS: { id: StatusComponent; label: string; short: string }[] = [
  ...SERVICE_COMPONENTS,
  { id: "washer_fluid", label: "Washer fluid", short: "Fluid" },
];

function milesFromKm(km: number | null): string { return km === null ? "" : String(Math.round(km / 1.609344)); }
function todayLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function ServiceStatus({ vehicle, records, care, loading, onSaved, onTireInspection, onWasherGuide, guideBusy, samplePreview = false }: {
  vehicle: Vehicle | null;
  records: MaintenanceRecord[];
  care: CareResponse | null;
  loading: boolean;
  onSaved: () => Promise<void>;
  onTireInspection: () => void;
  onWasherGuide: () => void;
  guideBusy: boolean;
  samplePreview?: boolean;
}) {
  const [intervals, setIntervals] = useState(() => loadServiceIntervals(vehicle?.vehicle_id || ""));
  const [selected, setSelected] = useState<StatusComponent | null>(null);
  const [editing, setEditing] = useState<ServiceComponent | null>(null);
  const [date, setDate] = useState("");
  const [odometer, setOdometer] = useState("");
  const [months, setMonths] = useState("");
  const [miles, setMiles] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualStatus, setManualStatus] = useState<OwnerManualStatus | null>(null);
  const manual = manufacturerSchedule(vehicle);
  const isHondaMinder = manual?.title === "2021 Civic Sedan";

  useEffect(() => { setIntervals(loadServiceIntervals(vehicle?.vehicle_id || "")); setSelected(null); setEditing(null); }, [vehicle?.vehicle_id]);
  useEffect(() => {
    if (!vehicle?.vehicle_id || !manual) { setManualStatus(null); return; }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async (attempt: number) => {
      try {
        const result = await api.ownerManualStatus(vehicle.vehicle_id);
        if (stopped) return;
        setManualStatus(result);
        if ((result.status === "downloading" || result.status === "available") && attempt < 30) {
          timer = setTimeout(() => void check(attempt + 1), 2000);
        }
      } catch { if (!stopped) setManualStatus(null); }
    };
    void check(0);
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [vehicle?.vehicle_id, vehicle?.year, vehicle?.make, vehicle?.model, vehicle?.trim, vehicle?.body_style, manual?.title]);
  useEffect(() => {
    if (!selected) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") { setSelected(null); setEditing(null); } };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selected]);

  const edit = (component: ServiceComponent) => {
    const record = latestService(records, component);
    const interval = intervals[component];
    setEditing(component);
    setDate(record?.completed_at.slice(0, 10) ?? "");
    setOdometer(milesFromKm(record?.odometer_km ?? null));
    setMonths(interval?.months?.toString() ?? (component === "brake_fluid" && isHondaMinder ? "36" : ""));
    setMiles(interval?.miles?.toString() ?? "");
    setError(null);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!vehicle || !editing || saving) return;
    const monthCount = months.trim() ? Number(months) : null;
    const mileCount = miles.trim() ? Number(miles) : null;
    if (!date || (monthCount === null && mileCount === null)) { setError("Enter the last service date and at least one interval."); return; }
    if (date > todayLocal()) { setError("The service date cannot be in the future."); return; }
    if ((monthCount !== null && (!Number.isInteger(monthCount) || monthCount < 1 || monthCount > 240)) ||
        (mileCount !== null && (!Number.isInteger(mileCount) || mileCount < 1 || mileCount > 200000))) {
      setError("Enter a valid interval (1–240 months or 1–200,000 miles)."); return;
    }
    const serviceOdometer = odometer.trim() ? Math.round(Number(odometer) * 1.609344) : null;
    if (serviceOdometer !== null && (!Number.isFinite(serviceOdometer) || serviceOdometer < 0 || (vehicle.odometer_km !== null && serviceOdometer > vehicle.odometer_km))) {
      setError("Check the odometer at the last service."); return;
    }
    setSaving(true); setError(null);
    try {
      const previous = latestService(records, editing);
      if (!previous || previous.completed_at.slice(0, 10) !== date || previous.odometer_km !== serviceOdometer) {
        await api.addRecord({
          vehicle_id: vehicle.vehicle_id, component: editing, event_type: "replacement",
          completed_at: new Date(`${date}T12:00:00`).toISOString(),
          ...(serviceOdometer !== null ? { odometer_km: serviceOdometer } : {}),
          user_confirmed: true,
        });
      }
      const interval: ServiceInterval = { months: monthCount, miles: mileCount };
      saveServiceInterval(vehicle.vehicle_id, editing, interval);
      setIntervals(loadServiceIntervals(vehicle.vehicle_id));
      setEditing(null);
      await onSaved();
    } catch { setError("Could not save the service schedule. Try again."); }
    finally { setSaving(false); }
  };

  const rowData = (id: StatusComponent) => {
    const record = samplePreview || id === "washer_fluid" ? null : latestService(records, id);
    const inspection = samplePreview ? null : records.filter((entry) => entry.component === id && entry.event_type === "inspection" && entry.user_confirmed)
      .sort((a, b) => b.completed_at.localeCompare(a.completed_at))[0] ?? null;
    const interval = samplePreview || id === "washer_fluid" ? undefined : intervals[id];
    const percent = samplePreview ? (id === "washer_fluid" ? null : SAMPLE_SERVICE_REMAINING[id]) : intervalRemaining(record, interval, vehicle?.odometer_km ?? null);
    const recommendation = care?.recommendations.find((item) => item.component === id);
    const manualItem = id === "washer_fluid" ? undefined : manual?.items[id];
    const tone: Tone = recommendation?.priority === "WARNING" || (percent !== null && percent <= 15) ? "due"
      : recommendation?.priority === "CHECK_SOON" || (percent !== null && percent <= 35) ? "soon"
      : recommendation?.priority === "ROUTINE" || percent !== null ? "good" : "unknown";
    const label = recommendation?.priority === "WARNING" ? "Warning" : tone === "due" ? "Due" : tone === "soon" ? "Check soon" : tone === "good" ? "On track" : "No estimate";
    return { record, inspection, interval, percent, recommendation, manualItem, tone, label };
  };

  const selectedItem = STATUS_COMPONENTS.find((item) => item.id === selected);
  const detail = selected ? rowData(selected) : null;

  return <section className="service-status-card" aria-label="Service interval status">
    <div className="service-status-heading"><h2>Service intervals</h2><p>{samplePreview ? "Sample estimates for screen review. Your records are unchanged." : "Percentages need a dated service record and an interval."}</p></div>
    {manual && <div className="service-status-manual"><span>{vehicle?.make} manual · {manual.title}{manualStatus?.status === "ready" ? " · Saved for quick access" : manualStatus?.status === "downloading" ? " · Saving…" : ""}</span><a href={manualStatus?.status === "ready" && vehicle ? api.ownerManualUrl(vehicle.vehicle_id) : manual.sourceUrl} target="_blank" rel="noopener noreferrer">{manualStatus?.status === "ready" ? "Open saved manual ↗" : "View manual schedule ↗"}</a>{manualStatus?.status === "failed" && vehicle && <button type="button" onClick={() => { void api.retryOwnerManual(vehicle.vehicle_id).then(setManualStatus).catch(() => setManualStatus(null)); }}>Retry download</button>}</div>}
    {!manual && vehicle?.make && vehicle?.model && <p className="service-status-note">No verified owner manual is indexed for this exact vehicle yet.</p>}
    {!manual && vehicle?.year === 2021 && vehicle.make?.toLowerCase() === "honda" && vehicle.model?.toLowerCase().includes("civic") && <div className="service-status-manual"><span>Official schedule for this Civic version is not loaded yet.</span></div>}
    <div className="service-status-list">
      {STATUS_COMPONENTS.map(({ id, label, short }) => {
        const { record, inspection, percent, recommendation, manualItem, tone, label: statusLabel } = rowData(id);
        const washerRefill = id === "washer_fluid" ? records.filter((entry) => entry.component === id && entry.event_type === "refill" && entry.user_confirmed)
          .sort((a, b) => b.completed_at.localeCompare(a.completed_at))[0] ?? null : null;
        const subtitle = samplePreview ? (id === "washer_fluid" ? "Check level directly" : "Review sample interval")
          : recommendation?.priority === "CHECK_SOON" || recommendation?.priority === "WARNING" ? recommendation.title
          : id === "washer_fluid" ? "Start guided check"
          : id === "tires" && !inspection ? "Record tire inspection"
          : !record ? "Add last service to estimate" : "Review service details";
        const lastEntry = inspection || record || washerRefill;
        const lastDate = lastEntry ? new Date(lastEntry.completed_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
        const historyLine = samplePreview ? "Sample data · not your service history" : id === "washer_fluid" ? `Last refill: ${lastDate || "unknown"} · Level not measured`
          : id === "brake_pads" || id === "tires" ? inspection ? `Last inspected: ${lastDate}` : record ? `Last changed: ${lastDate}` : "Last inspected: unknown"
          : `Last changed: ${record ? lastDate : "unknown"}`;
        const sourceLine = !samplePreview ? ` · Manual: ${manualItem?.code || "not loaded"}` : "";
        return <div className="service-status-row" key={id}>
          <button id={`status-detail-${id}`} type="button" className="service-status-trigger" onClick={() => { setSelected(id); setEditing(null); setError(null); }} aria-label={`${label}: ${statusLabel}. View details`} aria-haspopup="dialog">
            <span className="service-status-code">{short}</span>
            <span className="service-status-copy"><strong>{label}</strong><small>{loading ? "Checking records…" : subtitle}</small><em>{loading ? "" : `${historyLine}${sourceLine}`}</em></span>
            <span className={`service-status-light ${tone}`} aria-hidden="true"/>
            <span className={`service-status-value ${tone}`}>{loading || percent === null ? "—" : `${percent}%`}</span>
            <Icon name="chevron" size={15}/>
          </button>
          {id !== "washer_fluid" && percent !== null && <div className={`service-status-track ${tone}`} role="meter" aria-label={`${label} interval remaining`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${percent} percent remaining`}><span style={{ width: `${percent}%` }}/></div>}
        </div>;
      })}
    </div>
    <p className="service-status-note">{samplePreview ? "Sample percentages show how the indicators look. They are not vehicle condition or service advice." : isHondaMinder ? "Honda's Minder codes are service prompts, not separate part-life percentages. Estimates show schedule progress, not measured condition." : "Manual schedules are service prompts. Percentages show schedule progress, not measured condition."}</p>
    {selectedItem && detail && <div className="service-status-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) { setSelected(null); setEditing(null); } }}>
      <div className="service-status-dialog" role="dialog" aria-modal="true" aria-labelledby="service-status-dialog-title">
        <div className="service-status-dialog-top"><div><span className={`service-status-dialog-light ${detail.tone}`}/><span className="service-status-dialog-state">{detail.label}</span></div><button type="button" onClick={() => { setSelected(null); setEditing(null); }} aria-label="Close details">×</button></div>
        <h2 id="service-status-dialog-title">{selectedItem.label}</h2>
        {editing ? <form className="service-status-form" onSubmit={(event) => void save(event)}>
          <p>{selected === "brake_fluid" && isHondaMinder ? "Honda specifies a 3-year brake-fluid backstop if Minder 7 does not appear. Confirm the last replacement date." : detail.manualItem ? "Use your service history and the exact schedule for this vehicle. An inspection interval is not a replacement interval." : "Use the interval from your owner's manual or service plan."}</p>
          <div className="service-status-fields"><label>Last changed<input type="date" value={date} max={todayLocal()} onChange={(event) => setDate(event.target.value)} required/></label><label>Odometer then (mi)<input type="number" min="0" step="1" value={odometer} onChange={(event) => setOdometer(event.target.value)} placeholder="Optional"/></label></div>
          <div className="service-status-fields"><label>Every (months)<input type="number" min="1" max="240" step="1" value={months} onChange={(event) => setMonths(event.target.value)} placeholder="Optional"/></label><label>Every (miles)<input type="number" min="1" max="200000" step="1" value={miles} onChange={(event) => setMiles(event.target.value)} placeholder="Optional"/></label></div>
          {error && <p className="service-status-error" role="alert">{error}</p>}
          <button className="service-status-save" type="submit" disabled={saving}>{saving ? "Saving…" : "Save schedule"}</button>
          <button className="service-status-secondary" type="button" onClick={() => setEditing(null)}>Back to details</button>
        </form> : <>
          <p className="service-status-description">{samplePreview ? (detail.percent === null ? "Sample alert only. The washer fluid level needs a direct check." : `${detail.percent}% remaining in this sample. Your actual service history was not used.`) : detail.recommendation?.explanation ?? (detail.percent === null ? (detail.manualItem ? "No service baseline is saved. The manual schedule is not a remaining-life percentage." : "Add your last service and interval to see an estimate.") : `${detail.percent}% of the saved service interval remains. This is not a condition measurement.`)}</p>
          {detail.manualItem && manual && <div className="service-status-manual-detail"><strong>{isHondaMinder ? "Maintenance Minder" : "Manual schedule"} {detail.manualItem.code}</strong><p>{detail.manualItem.detail}</p><a href={manualStatus?.status === "ready" && vehicle ? api.ownerManualUrl(vehicle.vehicle_id) : manual.sourceUrl} target="_blank" rel="noopener noreferrer">{vehicle?.make} owner’s manual ↗</a></div>}
          {detail.record && detail.interval && <p className="service-status-dialog-meta">Last changed {new Date(detail.record.completed_at).toLocaleDateString("en-US", { dateStyle: "medium" })}{detail.record.odometer_km !== null ? ` · ${milesFromKm(detail.record.odometer_km)} mi` : ""}<br/>Your interval: {[detail.interval.months && `${detail.interval.months} months`, detail.interval.miles && `${detail.interval.miles.toLocaleString()} mi`].filter(Boolean).join(" or ")}</p>}
          {!samplePreview && detail.recommendation && <div className="service-status-evidence"><strong>Based on</strong>{detail.recommendation.evidence.filter((item) => item.value !== "Not provided").map((item) => <span key={item.label}>{item.label}: {item.value}</span>)}</div>}
          {!samplePreview && selected === "tires" && <button className="service-status-save" type="button" onClick={() => { setSelected(null); onTireInspection(); }}>Record tire inspection</button>}
          {!samplePreview && selected === "washer_fluid" && <button className="service-status-save" type="button" onClick={() => { setSelected(null); onWasherGuide(); }} disabled={guideBusy}>Start guided check</button>}
          {!samplePreview && selected !== "washer_fluid" && <button className="service-status-secondary" type="button" onClick={() => { if (selected) edit(selected); }}>{detail.interval ? "Edit service interval" : "Add last service & interval"}</button>}
        </>}
      </div>
    </div>}
  </section>;
}
