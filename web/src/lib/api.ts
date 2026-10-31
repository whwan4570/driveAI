// 백엔드 계약(backend/carmori/main.py)과 같은 모양을 유지한다.
import type { ServiceComponent } from "./serviceIntervals";
import type { NearbyPlace } from "./placeVisits";

export type Step = "FIND_INLET" | "OPEN_CAP" | "CONFIRM_PRODUCT" | "POUR" | "FINISH" | "RECORDED";
export type WaitReason =
  | "OCCLUDED"
  | "WRONG_PART"
  | "CAP_ALREADY_OPEN"
  | "PRODUCT_CONFLICT"
  | "PRODUCT_UNKNOWN"
  | "NEED_VOICE_CONFIRM";
export type VoiceIntent =
  | "PAUSE"
  | "RESUME"
  | "REPEAT"
  | "RESTART"
  | "CONFIRM_YES"
  | "CONFIRM_NO"
  | "EDIT_RECORD";
export type CompletionSource = "observed_sequence" | "user_voice_confirmed" | "manual_entry";

export interface VehicleSpecView {
  spec_id: string;
  display_name: string;
  years: [number, number];
}

export interface OwnerManualStatus {
  status: "unsupported" | "available" | "downloading" | "ready" | "failed";
  title: string | null;
  source_url: string | null;
  manual_url: string | null;
}

export interface Vehicle {
  vehicle_id: string;
  spec_id: string;
  year: number;
  make: string | null;
  model: string | null;
  trim: string | null;
  body_style: "sedan" | "hatchback" | null;
  odometer_km: number | null;
  odometer_updated_at: string | null;
  region: string | null;
  weekly_miles: number | null;
  highway_percent: number | null;
  driving_updated_at: string | null;
  driving_source: "gps" | "manual" | null;
  location_lat: number | null;
  location_lon: number | null;
  location_updated_at: string | null;
  nickname: string | null;
  purchased_on: string | null;
  first_drive_on: string | null;
  major_issue_free_confirmed: boolean;
  exterior_color: string | null;
  generated_image_data_url: string | null;
  image_status: "needs_color" | "pending" | "ready" | "failed";
  image_error: string | null;
  model_3d_url: string | null;
  model_3d_status: "unavailable" | "ready";
  model_3d_updated_at: string | null;
  profile_source: "manual" | "scan" | "document" | "demo";
  created_at: string;
}

export interface CareEvidence {
  label: string;
  value: string;
  source: "vehicle_profile" | "maintenance_record" | "user_driving_profile" | "phone_gps" | "external_weather" | "owner_manual";
  record_id: string | null;
}

export interface CareRecommendation {
  id: string;
  component: "washer_fluid" | "tires";
  priority: "WARNING" | "CHECK_SOON" | "ROUTINE" | "INFORMATION_NEEDED";
  title: string;
  explanation: string;
  evidence: CareEvidence[];
  unknown: string[];
  suggested_action: "washer_guide" | "tire_check";
  last_recorded_at: string | null;
  calculated_at: string;
  source: "contextual_inspection_rule";
  manufacturer_guidance_status: "unavailable" | "owner_manual";
}

export interface CareResponse {
  recommendations: CareRecommendation[];
  environment: { status: "available" | "unavailable"; provider: string; area: string | null; time_window: string | null; last_successful_update: string | null; rainfall_mm: number | null; forecast_low_c?: number | null };
  calculated_at: string;
}

export interface WasherShoppingPick {
  kind: "all_season" | "winter" | "extreme_cold" | "check_weather";
  product_name: string | null;
  freeze_rating_f: number | null;
  forecast_low_c: number | null;
  weather_as_of: string | null;
  reason: string;
  manufacturer_url: string | null;
  shop_url: string;
  retailer_verified: boolean;
}

export interface InspectionResult {
  status: "located" | "uncertain" | "unavailable";
  component: "washer_fluid" | "tires";
  observation: string;
  box: [number, number, number, number] | null;
  confidence: "high" | "medium" | "low" | "unknown";
  product_status: "MATCH" | "CONFLICT" | "UNKNOWN";
  product_label: string | null;
  source: "meta_vision" | "unavailable";
}

export interface VehicleScanResult {
  status: "recognized" | "unrecognized" | "unavailable";
  source: "vin" | "exterior" | "document";
  make: string | null;
  model: string | null;
  year: number | null;
  trim: string | null;
  exterior_color: string | null;
  vin_last4: string | null;
  document_type: DocumentType | null;
  sale_date: string | null;
  message: string;
}

export type DocumentType = "bill_of_sale" | "buyers_guide" | "odometer_disclosure" | "vehicle_history_report" | "window_sticker";

export interface SessionView {
  session_id: string;
  vehicle_id: string;
  step: Step;
  attempt: number;
  state_version: number;
  waiting_reason: WaitReason | null;
  paused: boolean;
}

export interface MaintenanceRecord {
  record_id: string;
  component: string;
  event_type: string;
  completed_at: string;
  completion_source: CompletionSource;
  product_label: string | null;
  flow_observed: boolean;
  odometer_km: number | null;
  notes: string | null;
  user_confirmed: boolean;
  photo_data_url: string | null;
  evidence_frames: string[];
  model_version: string | null;
}

export type MajorIssueKind = "accident" | "engine" | "transmission" | "brakes_steering" | "tow_required";

export interface MajorIssue {
  issue_id: string;
  vehicle_id: string;
  kind: MajorIssueKind;
  occurred_on: string;
  notes: string | null;
  created_at: string;
}

export interface SessionUpdate {
  session: SessionView;
  transition_reason: string;
  spoken_hint: string | null;
  record: MaintenanceRecord | null;
  transition_event: TransitionEvidence | null;
}

export interface TransitionEvidence {
  from_step: Step; to_step: Step; condition: string; sequence_ids: number[];
  frame_ids: string[]; model_version: string; decided_at: string;
  model_duration_ms: number; simulated: boolean;
}

export type SamTarget = "cap" | "bottle" | "inlet";
export interface SamDetection {
  frame_index: number;
  track_id: string;
  box: [number, number, number, number];
  confidence: number | null;
  mask_encoding: string;
  mask_payload: string;
  mask_width: number;
  mask_height: number;
}
export interface SamVideoResult {
  target: SamTarget;
  model_version: "sam-3.1";
  track_scope: "request";
  detections: SamDetection[];
}

export interface FrameIn {
  frame_id: string;
  captured_at: string;
  jpeg_base64: string;
}

export interface WindowIn {
  sequence_id: number;
  frames: FrameIn[];
}

const BASE = "/api";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const post = <T>(path: string, body: unknown) =>
  call<T>(path, { method: "POST", body: JSON.stringify(body) });

function bodyStyleKey(vehicleId: string): string { return `carmori:body-style:${vehicleId}`; }
function issueConfirmationKey(vehicleId: string): string { return `carmori:issue-confirmed:${vehicleId}`; }
function rememberBodyStyle(vehicleId: string, style: Vehicle["body_style"]): void {
  try {
    if (style) localStorage.setItem(bodyStyleKey(vehicleId), style);
    else localStorage.removeItem(bodyStyleKey(vehicleId));
  } catch { /* The server still stores the value when browser storage is unavailable. */ }
}
function withBodyStyle(vehicle: Vehicle): Vehicle {
  let saved: Vehicle["body_style"] = null;
  let locallyConfirmed = false;
  try {
    const value = localStorage.getItem(bodyStyleKey(vehicle.vehicle_id));
    if (value === "sedan" || value === "hatchback") saved = value;
    locallyConfirmed = localStorage.getItem(issueConfirmationKey(vehicle.vehicle_id)) === "true";
  } catch { /* Use the server value. */ }
  const demoSedan = vehicle.profile_source === "demo" && vehicle.year === 2021 &&
    vehicle.make?.toLowerCase() === "honda" && vehicle.model?.toLowerCase() === "civic" &&
    !/type r|hatch/i.test(vehicle.trim ?? "");
  return { ...vehicle, body_style: saved ?? vehicle.body_style ?? (demoSedan ? "sedan" : null),
    major_issue_free_confirmed: vehicle.major_issue_free_confirmed || locallyConfirmed };
}

export const api = {
  health: () => call<{ ok: boolean; spark: string; demo_mode: boolean; vision_status: "unverified" | "ready" | "missing_key" | "billing_required" | "unauthorized" | "provider_error" }>("/health"),
  nearbyPlaces: (lat: number, lon: number) => call<{ places: NearbyPlace[] }>(`/places/nearby?${new URLSearchParams({ lat: String(lat), lon: String(lon) })}`),
  vehicleSpecs: () => call<VehicleSpecView[]>("/vehicle-specs"),
  vehicleMakes: () => call<{ makes: string[]; popular: string[] }>("/vehicle-catalog/makes"),
  vehicleModels: (make: string, year: number | null) =>
    call<{ models: string[]; status: "available" | "unavailable" }>(
      `/vehicle-catalog/models?${new URLSearchParams({ make, ...(year ? { year: String(year) } : {}) })}`,
    ),
  recognitionStatus: () => call<{ available: boolean }>("/vehicles/recognition-status"),
  recognizeVehicle: (body: { mode: "vin" | "exterior"; jpeg_base64: string }) =>
    post<VehicleScanResult>("/vehicles/recognize", body),
  recognizeDocument: (body: { document_type: DocumentType; mime_type: "image/jpeg" | "image/png" | "application/pdf"; data_base64: string }) =>
    post<VehicleScanResult>("/vehicles/recognize-document", body),
  createVehicle: async (body: { spec_id: string; year: number; make: string; model: string; trim?: string; body_style?: "sedan" | "hatchback" | null; exterior_color: string; odometer_km: number; odometer_updated_at: string; region?: string; weekly_miles?: number; highway_percent?: number; nickname?: string; purchased_on?: string | null; first_drive_on?: string | null; major_issue_free_confirmed?: boolean; profile_source: "manual" | "scan" | "document" | "demo" }) => {
    let vehicle: Vehicle;
    try {
      vehicle = await post<Vehicle>("/vehicles", body);
    } catch (error) {
      if (!body.major_issue_free_confirmed || body.purchased_on || !(error instanceof Error) || !error.message.endsWith(" 422")) throw error;
      vehicle = await post<Vehicle>("/vehicles", { ...body, major_issue_free_confirmed: false });
      localStorage.setItem(issueConfirmationKey(vehicle.vehicle_id), "true");
    }
    if (body.body_style) rememberBodyStyle(vehicle.vehicle_id, body.body_style);
    return withBodyStyle(vehicle);
  },
  vehicle: async (vehicleId: string) => withBodyStyle(await call<Vehicle>(`/vehicles/${vehicleId}`)),
  ownerManualStatus: (vehicleId: string) => call<OwnerManualStatus>(`/vehicles/${vehicleId}/owner-manual/status`),
  ownerManualUrl: (vehicleId: string) => `${BASE}/vehicles/${vehicleId}/owner-manual`,
  retryOwnerManual: (vehicleId: string) => post<OwnerManualStatus>(`/vehicles/${vehicleId}/owner-manual/retry`, {}),
  updateVehicle: async (vehicleId: string, body: Partial<Pick<Vehicle, "year" | "make" | "model" | "trim" | "body_style" | "exterior_color" | "odometer_km" | "odometer_updated_at" | "region" | "weekly_miles" | "highway_percent" | "nickname" | "purchased_on" | "first_drive_on" | "major_issue_free_confirmed">>) => {
    let vehicle: Vehicle;
    try {
      vehicle = await call<Vehicle>(`/vehicles/${vehicleId}`, { method: "PATCH", body: JSON.stringify(body) });
    } catch (error) {
      // An older running local API still requires a purchase date for this confirmation.
      if (body.major_issue_free_confirmed !== true || !(error instanceof Error) || !error.message.endsWith(" 422")) throw error;
      const [current, issues] = await Promise.all([
        call<Vehicle>(`/vehicles/${vehicleId}`), call<MajorIssue[]>(`/vehicles/${vehicleId}/major-issues`),
      ]);
      if (("purchased_on" in body ? body.purchased_on : current.purchased_on) || issues.length) throw error;
      const updated = await call<Vehicle>(`/vehicles/${vehicleId}`, {
        method: "PATCH", body: JSON.stringify({ ...body, major_issue_free_confirmed: false }),
      });
      if ("body_style" in body) rememberBodyStyle(vehicleId, body.body_style ?? null);
      localStorage.setItem(issueConfirmationKey(vehicleId), "true");
      return withBodyStyle({ ...updated, major_issue_free_confirmed: true });
    }
    if ("body_style" in body) rememberBodyStyle(vehicleId, body.body_style ?? null);
    if ("major_issue_free_confirmed" in body) {
      if (body.major_issue_free_confirmed) localStorage.setItem(issueConfirmationKey(vehicleId), "true");
      else localStorage.removeItem(issueConfirmationKey(vehicleId));
    }
    return withBodyStyle(vehicle);
  },
  // Phone GPS: distance over the past 7 days and an approximate location for weather.
  drivingSummary: (vehicleId: string, body: { weekly_miles?: number; highway_percent?: number | null; lat?: number; lon?: number }) =>
    call<Vehicle>(`/vehicles/${vehicleId}/driving-summary`, { method: "PUT", body: JSON.stringify(body) }),
  retryVehicleImage: (vehicleId: string) => post<Vehicle>(`/vehicles/${vehicleId}/generate-image`, {}),
  memory: (vehicleId: string) => call<MaintenanceRecord[]>(`/vehicles/${vehicleId}/memory`),
  majorIssues: (vehicleId: string) => call<MajorIssue[]>(`/vehicles/${vehicleId}/major-issues`),
  addMajorIssue: async (vehicleId: string, body: { kind: MajorIssueKind; occurred_on: string; notes?: string }) => {
    const issue = await post<MajorIssue>(`/vehicles/${vehicleId}/major-issues`, body);
    localStorage.removeItem(issueConfirmationKey(vehicleId));
    return issue;
  },
  deleteMajorIssue: (vehicleId: string, issueId: string) =>
    call<void>(`/vehicles/${vehicleId}/major-issues/${issueId}`, { method: "DELETE" }),
  care: (vehicleId: string) => call<CareResponse>(`/vehicles/${vehicleId}/care-recommendations`),
  washerShopping: (vehicleId: string) => call<WasherShoppingPick>(`/vehicles/${vehicleId}/shopping/washer`),
  addRecord: (body: { vehicle_id: string; component: "washer_fluid" | ServiceComponent; event_type: "inspection" | "refill" | "rotation" | "replacement"; completed_at: string; odometer_km?: number; notes?: string; photo_data_url?: string; user_confirmed: true }) =>
    post<MaintenanceRecord>("/maintenance-records", body),
  analyzeInspection: (vehicleId: string, body: { component: "washer_fluid" | "tires"; photo_type: "engine" | "product" | "tire"; jpeg_base64: string }) =>
    post<InspectionResult>(`/vehicles/${vehicleId}/inspections/analyze`, body),
  briefing: (vehicleId: string, coords?: { lat: number; lon: number }) =>
    post<{ text: string }>("/briefings", { vehicle_id: vehicleId, ...coords }),
  ask: (vehicleId: string, question: string, sessionId?: string) =>
    post<{ text: string; fact_ids: string[]; source_url?: string | null; source_label?: string | null }>("/assistant/ask", { vehicle_id: vehicleId, question, session_id: sessionId }),
  startSession: (vehicleId: string) => post<SessionUpdate>("/sessions", { vehicle_id: vehicleId }),
  observe: (sessionId: string, windows: WindowIn[], expectedStateVersion: number) =>
    post<SessionUpdate>(`/sessions/${sessionId}/observations`, { windows, expected_state_version: expectedStateVersion }),
  trackClip: (sessionId: string, target: SamTarget, mp4: Blob) =>
    call<SamVideoResult>(`/sessions/${sessionId}/tracks?target=${target}`, {
      method: "POST", headers: { "Content-Type": "video/mp4" }, body: mp4,
    }),
  // via=touch: 화면 버튼으로 보낸 확인은 manual_entry로 기록된다.
  voice: (sessionId: string, intent: VoiceIntent, via: "voice" | "touch" = "voice") =>
    post<SessionUpdate>(`/sessions/${sessionId}/voice`, { intent, via }),
  transcribe: async (wav: Blob): Promise<string> => {
    const res = await fetch(`${BASE}/voice/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "audio/wav" },
      body: wav,
    });
    if (!res.ok) throw new Error(`transcribe ${res.status}`);
    return ((await res.json()) as { text: string }).text;
  },
};
