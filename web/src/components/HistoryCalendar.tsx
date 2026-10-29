import { useState } from "react";
import { type MaintenanceRecord, type MajorIssue } from "../lib/api";
import { formatVehicleDate, todayLocalISO } from "../lib/vehicleDates";
import { MAINTENANCE_LABELS } from "../lib/serviceIntervals";

type CalendarEvent = { type: "work"; record: MaintenanceRecord } | { type: "issue"; issue: MajorIssue };

const ISSUE_NAMES: Record<MajorIssue["kind"], string> = {
  accident: "Accident",
  engine: "Engine failure",
  transmission: "Transmission failure",
  brakes_steering: "Brake or steering failure",
  tow_required: "Breakdown requiring a tow",
};

function localDateKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function HistoryCalendar({ records, issues }: { records: MaintenanceRecord[]; issues: MajorIssue[] }) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(todayLocalISO);
  const events = new Map<string, CalendarEvent[]>();
  for (const record of records) {
    const key = localDateKey(new Date(record.completed_at));
    events.set(key, [...(events.get(key) ?? []), { type: "work", record }]);
  }
  for (const issue of issues) {
    events.set(issue.occurred_on, [...(events.get(issue.occurred_on) ?? []), { type: "issue", issue }]);
  }

  const year = month.getFullYear();
  const monthNumber = month.getMonth();
  const offset = new Date(year, monthNumber, 1).getDay();
  const days = new Date(year, monthNumber + 1, 0).getDate();
  const cellCount = Math.ceil((offset + days) / 7) * 7;
  const selectedEvents = events.get(selectedDate) ?? [];
  const moveMonth = (delta: number) => {
    const next = new Date(year, monthNumber + delta, 1);
    setMonth(next);
    setSelectedDate(localDateKey(next));
  };
  const jumpToToday = () => {
    const now = new Date();
    setMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDate(localDateKey(now));
  };

  return <div className="history-calendar">
    <div className="history-calendar-toolbar"><div><button type="button" onClick={() => moveMonth(-1)} aria-label="Previous month">‹</button><strong>{month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</strong><button type="button" onClick={() => moveMonth(1)} aria-label="Next month">›</button></div><button type="button" onClick={jumpToToday}>Today</button></div>
    <div className="history-calendar-grid" role="group" aria-label="History calendar">
      {(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const).map((day) => <span className="history-calendar-weekday" key={day}>{day}</span>)}
      {Array.from({ length: cellCount }, (_, index) => {
        const day = index - offset + 1;
        if (day < 1 || day > days) return <span className="history-calendar-blank" key={`blank-${index}`}/>;
        const key = localDateKey(new Date(year, monthNumber, day));
        const dayEvents = events.get(key) ?? [];
        return <button type="button" key={key} className={`history-calendar-day${selectedDate === key ? " selected" : ""}${todayLocalISO() === key ? " today" : ""}`} aria-label={`${formatVehicleDate(key)}, ${dayEvents.length} ${dayEvents.length === 1 ? "event" : "events"}`} aria-pressed={selectedDate === key} onClick={() => setSelectedDate(key)}><span>{day}</span>{dayEvents.length > 0 && <span className="history-calendar-dots" aria-hidden="true">{dayEvents.some((event) => event.type === "work") && <i className="work"/>}{dayEvents.some((event) => event.type === "issue") && <i className="issue"/>}</span>}</button>;
      })}
    </div>
    <div className="history-calendar-selected"><h3>{formatVehicleDate(selectedDate)}</h3>{selectedEvents.length === 0 ? <p>No saved events on this day.</p> : selectedEvents.map((event) => event.type === "issue" ? <article className="history-calendar-event issue" key={event.issue.issue_id}><strong>{ISSUE_NAMES[event.issue.kind]}</strong><small>Major issue</small>{event.issue.notes && <p>{event.issue.notes}</p>}</article> : <article className="history-calendar-event" key={event.record.record_id}><strong>{MAINTENANCE_LABELS[event.record.component] || event.record.component} {event.record.event_type}</strong><small>{new Date(event.record.completed_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · Completed work</small>{event.record.notes && <p>{event.record.notes}</p>}{event.record.photo_data_url && <img src={event.record.photo_data_url} alt="Maintenance record"/>}</article>)}</div>
  </div>;
}
