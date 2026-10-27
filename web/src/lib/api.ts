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
}

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
  completed_at: string;
  completion_source: CompletionSource;
  product_label: string | null;
  flow_observed: boolean;
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
  vehicleSpecs: () => call<VehicleSpecView[]>("/vehicle-specs"),
  createVehicle: (body: { spec_id: string; year: number; last_refill_at?: string }) =>
    post<Vehicle>("/vehicles", body),
  memory: (vehicleId: string) => call<MaintenanceRecord[]>(`/vehicles/${vehicleId}/memory`),
  briefing: (vehicleId: string, coords?: { lat: number; lon: number }) =>
    post<{ text: string }>("/briefings", { vehicle_id: vehicleId, ...coords }),
  ask: (vehicleId: string, question: string) =>
    post<{ text: string; fact_ids: string[] }>("/assistant/ask", { vehicle_id: vehicleId, question }),
  startSession: (vehicleId: string) => post<SessionUpdate>("/sessions", { vehicle_id: vehicleId }),
  observe: (sessionId: string, windows: WindowIn[]) =>
    post<SessionUpdate>(`/sessions/${sessionId}/observations`, { windows }),
  voice: (sessionId: string, intent: VoiceIntent) =>
    post<SessionUpdate>(`/sessions/${sessionId}/voice`, { intent }),
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
