// 백엔드 계약(backend/carmori/main.py)과 같은 모양을 유지한다.

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

export interface Vehicle {
  vehicle_id: string;
  spec_id: string;
  year: number;
  make: string | null;
  model: string | null;
  trim: string | null;
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
  exterior_color: string | null;
  generated_image_data_url: string | null;
  image_status: "needs_color" | "pending" | "ready" | "failed";
  image_error: string | null;
  profile_source: "manual" | "scan" | "document" | "demo";
}

export interface CareEvidence {
  label: string;
  value: string;
  source: "vehicle_profile" | "maintenance_record" | "user_driving_profile" | "phone_gps" | "external_weather";
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
  manufacturer_guidance_status: "unavailable";
}

export interface CareResponse {
  recommendations: CareRecommendation[];
  environment: { status: "available" | "unavailable"; provider: string; area: string | null; time_window: string | null; last_successful_update: string | null; rainfall_mm: number | null };
  calculated_at: string;
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
  message: string;
}

export type DocumentType = "buyers_guide" | "odometer_disclosure" | "vehicle_history_report" | "window_sticker";

export interface SessionView {
  session_id: string;
  vehicle_id: string;
  step: Step;
  attempt: number;
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
}

export interface SessionUpdate {
  session: SessionView;
  transition_reason: string;
  spoken_hint: string | null;
  record: MaintenanceRecord | null;
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
  return (await res.json()) as T;
}

const post = <T>(path: string, body: unknown) =>
  call<T>(path, { method: "POST", body: JSON.stringify(body) });

export const api = {
  health: () => call<{ ok: boolean; spark: string; demo_mode: boolean; vision_status: "unverified" | "ready" | "missing_key" | "billing_required" | "unauthorized" | "provider_error" }>("/health"),
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
  createVehicle: (body: { spec_id: string; year: number; make: string; model: string; trim?: string; exterior_color: string; odometer_km: number; odometer_updated_at: string; region?: string; weekly_miles?: number; highway_percent?: number; nickname?: string; profile_source: "manual" | "scan" | "document" | "demo" }) =>
    post<Vehicle>("/vehicles", body),
  vehicle: (vehicleId: string) => call<Vehicle>(`/vehicles/${vehicleId}`),
  updateVehicle: (vehicleId: string, body: Partial<Pick<Vehicle, "year" | "make" | "model" | "trim" | "exterior_color" | "odometer_km" | "odometer_updated_at" | "region" | "weekly_miles" | "highway_percent" | "nickname">>) =>
    call<Vehicle>(`/vehicles/${vehicleId}`, { method: "PATCH", body: JSON.stringify(body) }),
  // Phone GPS: distance over the past 7 days and an approximate location for weather.
  drivingSummary: (vehicleId: string, body: { weekly_miles?: number; highway_percent?: number | null; lat?: number; lon?: number }) =>
    call<Vehicle>(`/vehicles/${vehicleId}/driving-summary`, { method: "PUT", body: JSON.stringify(body) }),
  retryVehicleImage: (vehicleId: string) => post<Vehicle>(`/vehicles/${vehicleId}/generate-image`, {}),
  memory: (vehicleId: string) => call<MaintenanceRecord[]>(`/vehicles/${vehicleId}/memory`),
  care: (vehicleId: string) => call<CareResponse>(`/vehicles/${vehicleId}/care-recommendations`),
  addRecord: (body: { vehicle_id: string; component: "washer_fluid" | "tires"; event_type: "inspection" | "refill" | "rotation" | "replacement"; completed_at: string; odometer_km?: number; notes?: string; photo_data_url?: string; user_confirmed: true }) =>
    post<MaintenanceRecord>("/maintenance-records", body),
  analyzeInspection: (vehicleId: string, body: { component: "washer_fluid" | "tires"; photo_type: "engine" | "product" | "tire"; jpeg_base64: string }) =>
    post<InspectionResult>(`/vehicles/${vehicleId}/inspections/analyze`, body),
  briefing: (vehicleId: string, coords?: { lat: number; lon: number }) =>
    post<{ text: string }>("/briefings", { vehicle_id: vehicleId, ...coords }),
  ask: (vehicleId: string, question: string) =>
    post<{ text: string; fact_ids: string[] }>("/assistant/ask", { vehicle_id: vehicleId, question }),
  startSession: (vehicleId: string) => post<SessionUpdate>("/sessions", { vehicle_id: vehicleId }),
  observe: (sessionId: string, windows: WindowIn[]) =>
    post<SessionUpdate>(`/sessions/${sessionId}/observations`, { windows }),
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
