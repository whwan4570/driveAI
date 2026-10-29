import { useEffect, useState, type FormEvent } from "react";
import { api, type CareResponse, type MaintenanceRecord, type Vehicle } from "../lib/api";
import { intervalRemaining, latestService, loadServiceIntervals, saveServiceInterval, SERVICE_COMPONENTS, type ServiceComponent, type ServiceInterval } from "../lib/serviceIntervals";

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

export function ServiceStatus({ vehicle, records, care, loading, onSaved, onTireInspection, onWasherGuide, guideBusy }: {
  vehicle: Vehicle | null;
  records: MaintenanceRecord[];
  care: CareResponse | null;
  loading: boolean;
  onSaved: () => Promise<void>;
  onTireInspection: () => void;
  onWasherGuide: () => void;
  guideBusy: boolean;
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

  useEffect(() => { setIntervals(loadServiceIntervals(vehicle?.vehicle_id || "")); setSelected(null); setEditing(null); }, [vehicle?.vehicle_id]);
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
    setMonths(interval?.months?.toString() ?? "");
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
    const record = id === "washer_fluid" ? null : latestService(records, id);
    const interval = id === "washer_fluid" ? undefined : intervals[id];
    const percent = intervalRemaining(record, interval, vehicle?.odometer_km ?? null);
    const recommendation = care?.recommendations.find((item) => item.component === id);
    const tone: Tone = recommendation?.priority === "WARNING" || (percent !== null && percent <= 15) ? "due"
      : recommendation?.priority === "CHECK_SOON" || (percent !== null && percent <= 35) ? "soon"
      : recommendation?.priority === "ROUTINE" || percent !== null ? "good" : "unknown";
    const label = recommendation?.priority === "WARNING" ? "Warning" : tone === "due" ? "Due" : tone === "soon" ? "Check soon" : tone === "good" ? "On track" : "No estimate";
    return { record, interval, percent, recommendation, tone, label };
  };

  const selectedItem = STATUS_COMPONENTS.find((item) => item.id === selected);
  const detail = selected ? rowData(selected) : null;

  return <section className="service-status-card" aria-label="Service interval status">
    <div className="service-status-heading"><h2>Service intervals</h2><p>Percentages need a dated service record and an interval.</p></div>
    <div className="service-status-list">
      {STATUS_COMPONENTS.map(({ id, label, short }) => {
        const { record, interval, percent, recommendation, tone, label: statusLabel } = rowData(id);
        const subtitle = recommendation?.priority === "CHECK_SOON" || recommendation?.priority === "WARNING" ? recommendation.title
          : record && interval ? `Last changed ${new Date(record.completed_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
          : id === "washer_fluid" ? recommendation?.title || "Level not measured" : "Add last service and interval";
        return <div className="service-status-row" key={id}>
          <button id={`status-detail-${id}`} type="button" className="service-status-trigger" onClick={() => { setSelected(id); setEditing(null); setError(null); }} aria-label={`${label}: ${statusLabel}. View details`} aria-haspopup="dialog">
            <span className="service-status-code">{short}</span>
            <span className="service-status-copy"><strong>{label}</strong><small>{loading ? "Checking records…" : subtitle}</small></span>
            <span className={`service-status-light ${tone}`} aria-hidden="true"/>
            <span className={`service-status-value ${tone}`}>{loading || percent === null ? "—" : `${percent}%`}</span>
          </button>
          {id !== "washer_fluid" && percent !== null && <div className={`service-status-track ${tone}`} role="meter" aria-label={`${label} interval remaining`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${percent} percent remaining`}><span style={{ width: `${percent}%` }}/></div>}
        </div>;
      })}
    </div>
    <p className="service-status-note">Estimates show your saved service interval remaining, not measured part condition.</p>
    {selectedItem && detail && <div className="service-status-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) { setSelected(null); setEditing(null); } }}>
      <div className="service-status-dialog" role="dialog" aria-modal="true" aria-labelledby="service-status-dialog-title">
        <div className="service-status-dialog-top"><div><span className={`service-status-dialog-light ${detail.tone}`}/><span className="service-status-dialog-state">{detail.label}</span></div><button type="button" onClick={() => { setSelected(null); setEditing(null); }} aria-label="Close details">×</button></div>
        <h2 id="service-status-dialog-title">{selectedItem.label}</h2>
        {editing ? <form className="service-status-form" onSubmit={(event) => void save(event)}>
          <p>Use the interval from your owner's manual or service plan.</p>
          <div className="service-status-fields"><label>Last changed<input type="date" value={date} max={todayLocal()} onChange={(event) => setDate(event.target.value)} required/></label><label>Odometer then (mi)<input type="number" min="0" step="1" value={odometer} onChange={(event) => setOdometer(event.target.value)} placeholder="Optional"/></label></div>
          <div className="service-status-fields"><label>Every (months)<input type="number" min="1" max="240" step="1" value={months} onChange={(event) => setMonths(event.target.value)} placeholder="Optional"/></label><label>Every (miles)<input type="number" min="1" max="200000" step="1" value={miles} onChange={(event) => setMiles(event.target.value)} placeholder="Optional"/></label></div>
          {error && <p className="service-status-error" role="alert">{error}</p>}
          <button className="service-status-save" type="submit" disabled={saving}>{saving ? "Saving…" : "Save schedule"}</button>
          <button className="service-status-secondary" type="button" onClick={() => setEditing(null)}>Back to details</button>
        </form> : <>
          <p className="service-status-description">{detail.recommendation?.explanation ?? (detail.percent === null ? "Add your last service and interval to see an estimate." : `${detail.percent}% of the saved service interval remains. This is not a condition measurement.`)}</p>
          {detail.record && detail.interval && <p className="service-status-dialog-meta">Last changed {new Date(detail.record.completed_at).toLocaleDateString("en-US", { dateStyle: "medium" })}{detail.record.odometer_km !== null ? ` · ${milesFromKm(detail.record.odometer_km)} mi` : ""}<br/>Your interval: {[detail.interval.months && `${detail.interval.months} months`, detail.interval.miles && `${detail.interval.miles.toLocaleString()} mi`].filter(Boolean).join(" or ")}</p>}
          {detail.recommendation && <div className="service-status-evidence"><strong>Based on</strong>{detail.recommendation.evidence.filter((item) => item.value !== "Not provided").map((item) => <span key={item.label}>{item.label}: {item.value}</span>)}</div>}
          {selected === "tires" && <button className="service-status-save" type="button" onClick={() => { setSelected(null); onTireInspection(); }}>Record tire inspection</button>}
          {selected === "washer_fluid" && <button className="service-status-save" type="button" onClick={() => { setSelected(null); onWasherGuide(); }} disabled={guideBusy}>Start guided check</button>}
          {selected !== "washer_fluid" && <button className="service-status-secondary" type="button" onClick={() => { if (selected) edit(selected); }}>{detail.interval ? "Edit service interval" : "Add last service & interval"}</button>}
        </>}
      </div>
    </div>}
  </section>;
}
