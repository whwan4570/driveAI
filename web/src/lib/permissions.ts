// Carmori's own on/off switches for location, microphone, camera and compass, plus the browser's answer.
// A page cannot revoke a permission the browser already granted, so "off" means Carmori stops
// using that sensor; "on" asks the browser when it has not been asked yet.

export type AppPermission = "location" | "microphone" | "camera" | "motion";
export type BrowserPermission = "granted" | "denied" | "prompt" | "unknown";
export type PermissionSettings = Record<AppPermission, boolean>;

const KEY = "carmori:permissions";
const DEFAULTS: PermissionSettings = { location: true, microphone: true, camera: true, motion: true };

export function readPermissionSettings(): PermissionSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null") as Partial<PermissionSettings> | null;
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePermissionSetting(permission: AppPermission, enabled: boolean): PermissionSettings {
  const next = { ...readPermissionSettings(), [permission]: enabled };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* Keep it for this session. */ }
  return next;
}

export async function browserPermission(permission: AppPermission): Promise<BrowserPermission> {
  // Browsers do not report the compass permission; iOS asks for it the first time it is used.
  if (permission === "motion") return "unknown";
  try {
    const name = (permission === "location" ? "geolocation" : permission) as PermissionName;
    return (await navigator.permissions.query({ name })).state;
  } catch {
    return "unknown";
  }
}

/** Asks the browser once. Resolves false only when the user or browser blocks it. */
export async function requestBrowserPermission(permission: AppPermission): Promise<boolean> {
  if (permission === "motion") {
    const orientation = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof orientation.requestPermission !== "function") return true;
    try { return (await orientation.requestPermission()) === "granted"; } catch { return false; }
  }
  if (permission === "location") {
    if (!navigator.geolocation) return false;
    return new Promise((resolve) => navigator.geolocation.getCurrentPosition(
      () => resolve(true),
      (error) => resolve(error.code !== error.PERMISSION_DENIED),
      { timeout: 15000, maximumAge: 60000 },
    ));
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia(permission === "camera" ? { video: true } : { audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch {
    return false;
  }
}

export function permissionStatusText(enabled: boolean, state: BrowserPermission): string {
  if (!enabled) return "Off · Carmori won't use it";
  if (state === "denied") return "Blocked in browser settings";
  if (state === "granted") return "Allowed";
  return "Asks when first used";
}
