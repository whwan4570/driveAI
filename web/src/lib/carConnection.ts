// CarPlay / Android Auto connection from the native shell (ios/App/App/CarConnectionPlugin.swift,
// android/.../CarConnectionPlugin.java). In a browser the plugin does not exist, so callers check
// carConnectionAvailable first.

import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export interface CarState {
  connected: boolean;
  kind: "carplay" | "android_auto" | null;
}

interface CarConnectionPlugin {
  getState(): Promise<CarState>;
  /** Native text-to-speech routed to the car speakers. Resolves when speech ends. */
  speak(options: { text: string; lang?: string }): Promise<void>;
  stopSpeaking(): Promise<void>;
  addListener(event: "carConnectionChange", listener: (state: CarState) => void): Promise<PluginListenerHandle>;
}

export const CarConnection = registerPlugin<CarConnectionPlugin>("CarConnection");
export const carConnectionAvailable = Capacitor.isNativePlatform();

const SETTING_KEY = "carmori:car-briefing";

export function readCarBriefingSetting(): boolean {
  try { return localStorage.getItem(SETTING_KEY) !== "off"; } catch { return true; }
}

export function saveCarBriefingSetting(enabled: boolean): void {
  try { localStorage.setItem(SETTING_KEY, enabled ? "on" : "off"); } catch { /* Keep it for this session. */ }
}
