import type { CareResponse } from "./api";
import type { DriveSummary } from "./driveMetrics";
import type { ServiceComponent } from "./serviceIntervals";

const mile = 1609.344;

export const SAMPLE_DRIVE_SUMMARY: DriveSummary = {
  todayMeters: 18.6 * mile,
  typicalMeters: 24.2 * mile,
  speedMps: 36 / 2.236936,
  trackedDays: 5,
  weekMeters: 138.4 * mile,
  weekHighwayMeters: 84.4 * mile,
  weekTrackedDays: 6,
};

export const SAMPLE_SERVICE_REMAINING: Record<ServiceComponent, number> = {
  engine_oil: 24,
  engine_oil_filter: 24,
  tires: 12,
  brake_pads: 68,
  brake_fluid: 43,
  transmission_fluid: 81,
  cabin_filter: 34,
  engine_air_filter: 57,
  spark_plugs: 91,
  engine_coolant: 76,
  drive_belt: 49,
};

export function sampleStatusCare(care: CareResponse | null): CareResponse {
  const calculatedAt = new Date().toISOString();
  return {
    environment: care?.environment ?? { status: "unavailable", provider: "", area: null, time_window: null, last_successful_update: null, rainfall_mm: null },
    calculated_at: calculatedAt,
    recommendations: [
      {
        id: "sample-tires", component: "tires", priority: "CHECK_SOON", title: "Inspect tires soon",
        explanation: "Sample alert for reviewing the Status screen. This is not a finding about your car.",
        evidence: [], unknown: [], suggested_action: "tire_check", last_recorded_at: null,
        calculated_at: calculatedAt, source: "contextual_inspection_rule", manufacturer_guidance_status: "unavailable",
      },
      {
        id: "sample-washer", component: "washer_fluid", priority: "WARNING", title: "Check washer fluid",
        explanation: "Sample alert for reviewing the Status screen. Check the level directly before acting.",
        evidence: [], unknown: [], suggested_action: "washer_guide", last_recorded_at: null,
        calculated_at: calculatedAt, source: "contextual_inspection_rule", manufacturer_guidance_status: "unavailable",
      },
    ],
  };
}
