import type { MaintenanceRecord } from "./api";

export type ServiceComponent = "engine_oil" | "tires" | "brake_pads" | "cabin_filter" | "engine_air_filter";

export const SERVICE_COMPONENTS: { id: ServiceComponent; label: string; short: string }[] = [
  { id: "engine_oil", label: "Engine oil", short: "Oil" },
  { id: "tires", label: "Tires", short: "Tire" },
  { id: "brake_pads", label: "Brake pads", short: "Brake" },
  { id: "cabin_filter", label: "Cabin air filter", short: "Cabin" },
  { id: "engine_air_filter", label: "Engine air filter", short: "Engine" },
];

export const MAINTENANCE_LABELS: Record<string, string> = {
  washer_fluid: "Washer fluid",
  ...Object.fromEntries(SERVICE_COMPONENTS.map(({ id, label }) => [id, label])),
};

export type ServiceInterval = { months: number | null; miles: number | null };
type ServiceIntervals = Partial<Record<ServiceComponent, ServiceInterval>>;

function storageKey(vehicleId: string): string { return `carmori:service-intervals:${vehicleId}`; }

export function loadServiceIntervals(vehicleId: string): ServiceIntervals {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey(vehicleId)) || "{}");
    if (!value || typeof value !== "object") return {};
    const input = value as Record<string, unknown>;
    const result: ServiceIntervals = {};
    for (const { id } of SERVICE_COMPONENTS) {
      const row = input[id];
      if (!row || typeof row !== "object") continue;
      const fields = row as Record<string, unknown>;
      const months = typeof fields.months === "number" && Number.isInteger(fields.months) && fields.months > 0 ? fields.months : null;
      const miles = typeof fields.miles === "number" && Number.isInteger(fields.miles) && fields.miles > 0 ? fields.miles : null;
      if (months !== null || miles !== null) result[id] = { months, miles };
    }
    return result;
  } catch { return {}; }
}
export function saveServiceInterval(vehicleId: string, component: ServiceComponent, interval: ServiceInterval): void {
  const current = loadServiceIntervals(vehicleId);
  current[component] = interval;
  localStorage.setItem(storageKey(vehicleId), JSON.stringify(current));
}

export function latestService(records: MaintenanceRecord[], component: ServiceComponent): MaintenanceRecord | null {
  return records.filter((record) => record.component === component && record.event_type === "replacement" && record.user_confirmed)
    .sort((a, b) => b.completed_at.localeCompare(a.completed_at))[0] ?? null;
}

export function intervalRemaining(record: MaintenanceRecord | null, interval: ServiceInterval | undefined, odometerKm: number | null, now = new Date()): number | null {
  if (!record || !interval) return null;
  const fractions: number[] = [];
  if (interval.months !== null) {
    const completed = new Date(record.completed_at);
    if (!Number.isNaN(completed.getTime()) && completed <= now) {
      const due = new Date(completed);
      due.setMonth(due.getMonth() + interval.months);
      const duration = due.getTime() - completed.getTime();
      if (duration > 0) fractions.push(1 - (now.getTime() - completed.getTime()) / duration);
    }
  }
  if (interval.miles !== null && record.odometer_km !== null && odometerKm !== null && odometerKm >= record.odometer_km) {
    const elapsedMiles = (odometerKm - record.odometer_km) / 1.609344;
    fractions.push(1 - elapsedMiles / interval.miles);
  }
  if (!fractions.length) return null;
  return Math.round(Math.max(0, Math.min(1, Math.min(...fractions))) * 100);
}
