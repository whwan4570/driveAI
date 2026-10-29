import { useState, type FormEvent } from "react";
import { api, type MajorIssue, type MajorIssueKind, type Vehicle } from "../lib/api";
import { daysSince, formatVehicleDate, localDateISO, todayLocalISO } from "../lib/vehicleDates";

const ISSUE_LABELS: Record<MajorIssueKind, string> = {
  accident: "Accident",
  engine: "Engine failure",
  transmission: "Transmission failure",
  brakes_steering: "Brake or steering failure",
  tow_required: "Breakdown requiring a tow",
};

export function HistorySummary({ vehicle, issues, issuesLoading, issuesAvailable, onEditVehicle, onVehicleUpdated, onRefresh }: {
  vehicle: Vehicle | null;
  issues: MajorIssue[];
  issuesLoading: boolean;
  issuesAvailable: boolean;
  onEditVehicle: () => void;
  onVehicleUpdated: (updated: Vehicle) => void;
  onRefresh: () => Promise<void>;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [kind, setKind] = useState<MajorIssueKind>("accident");
  const [occurredOn, setOccurredOn] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const appStart = localDateISO(vehicle?.created_at);
  const togetherDays = daysSince(vehicle?.purchased_on ?? appStart);
  const latestIssue = issuesAvailable ? issues[0] ?? null : null;
  const issueFreeDays = issuesLoading || !issuesAvailable ? null : latestIssue
    ? daysSince(latestIssue.occurred_on)
    : vehicle?.major_issue_free_confirmed ? togetherDays : null;

  const confirmNoIssues = async () => {
    if (!vehicle || issues.length || !issuesAvailable || busy) return;
    setBusy(true);
    setError(null);
    try {
      onVehicleUpdated(await api.updateVehicle(vehicle.vehicle_id, { major_issue_free_confirmed: true }));
    } catch {
      setError("Could not save your confirmation. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const addIssue = async (event: FormEvent) => {
    event.preventDefault();
    if (!vehicle || !occurredOn || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.addMajorIssue(vehicle.vehicle_id, { kind, occurred_on: occurredOn, notes: notes.trim() || undefined });
      setFormOpen(false);
      setOccurredOn("");
      setNotes("");
      await onRefresh();
    } catch {
      setError("Could not save this issue. Check the date and try again.");
    } finally {
      setBusy(false);
    }
  };

  const removeIssue = async (issue: MajorIssue) => {
    if (!vehicle || busy || !window.confirm(`Remove the ${ISSUE_LABELS[issue.kind].toLowerCase()} logged on ${formatVehicleDate(issue.occurred_on)}?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteMajorIssue(vehicle.vehicle_id, issue.issue_id);
      await onRefresh();
    } catch {
      setError("Could not remove this issue. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return <div className="history-summary">
    <section className="relationship-card" aria-label="Your time with this vehicle">
      <div className="relationship-metric">
        <div className="relationship-card-top"><h1>Days together</h1><button type="button" onClick={onEditVehicle}>{vehicle?.purchased_on ? "Edit dates" : "Add dates"}</button></div>
        <strong className="relationship-count">{togetherDays === null ? "—" : togetherDays.toLocaleString()}<span>{togetherDays === null ? "" : " days"}</span></strong>
        <p>{vehicle?.purchased_on ? `Since you bought this car on ${formatVehicleDate(vehicle.purchased_on)}` : appStart ? `Since you added this car to Carmori on ${formatVehicleDate(appStart)}` : "Add a date to start the count."}</p>
        {vehicle?.first_drive_on ? <p className="relationship-secondary">First drove it on {formatVehicleDate(vehicle.first_drive_on)}</p>
          : appStart && <p className="relationship-secondary">First drive date unknown · tracking from {formatVehicleDate(appStart)}</p>}
      </div>

      <div className="relationship-metric issue-metric">
        <div className="issue-card-top"><h2>Days without a major issue</h2><strong>{issuesLoading ? "…" : issueFreeDays === null ? "—" : issueFreeDays.toLocaleString()}</strong></div>
        <p>{issuesLoading ? "Checking your records…" : !issuesAvailable ? "Could not load issue history. Try again." : latestIssue
          ? `Since the ${ISSUE_LABELS[latestIssue.kind].toLowerCase()} logged on ${formatVehicleDate(latestIssue.occurred_on)}.`
          : vehicle?.major_issue_free_confirmed && (vehicle.purchased_on || appStart)
            ? `Based on your confirmation since ${formatVehicleDate(vehicle.purchased_on ?? appStart)}.`
            : "Confirm your history or log a major issue to start this count."}</p>
        <p className="issue-scope">Reported accidents and major breakdowns only. Routine maintenance doesn't reset the count.</p>
        <div className="issue-actions">
          {vehicle && !issuesLoading && issuesAvailable && !issues.length && !vehicle.major_issue_free_confirmed && <button type="button" onClick={() => void confirmNoIssues()} disabled={busy}>Confirm no major issues since {vehicle.purchased_on ? "purchase" : "adding this car"}</button>}
          {!issuesLoading && !issuesAvailable && <button type="button" onClick={() => void onRefresh()} disabled={busy}>Retry</button>}
          <button type="button" onClick={() => setFormOpen((open) => !open)} disabled={!vehicle || busy}>{formOpen ? "Cancel" : "Log major issue"}</button>
        </div>
        {formOpen && <form className="issue-form" onSubmit={(event) => void addIssue(event)}>
          <label>Type<select value={kind} onChange={(event) => setKind(event.target.value as MajorIssueKind)}>{Object.entries(ISSUE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Date<input type="date" min={vehicle?.purchased_on ?? undefined} max={todayLocalISO()} value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} required/></label>
          <label>Notes <span className="optional">optional</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} placeholder="What happened?"/></label>
          <button className="primary" type="submit" disabled={busy || !occurredOn}>{busy ? "Saving…" : "Save issue"}</button>
        </form>}
        {issues.length > 0 && <div className="issue-list"><h3>Logged major issues</h3>{issues.map((issue) => <div className="issue-row" key={issue.issue_id}><div><strong>{ISSUE_LABELS[issue.kind]}</strong><span>{formatVehicleDate(issue.occurred_on)}{issue.notes ? ` · ${issue.notes}` : ""}</span></div><button type="button" onClick={() => void removeIssue(issue)} disabled={busy} aria-label={`Remove ${ISSUE_LABELS[issue.kind]} from ${formatVehicleDate(issue.occurred_on)}`}>Remove</button></div>)}</div>}
        {error && <p className="inline-error" role="alert">{error}</p>}
      </div>
    </section>
  </div>;
}
