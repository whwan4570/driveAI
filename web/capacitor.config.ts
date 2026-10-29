import type { CapacitorConfig } from "@capacitor/cli";

// The native shell loads the Vite dev server so /api and /pipecat keep going through its proxy.
//   iOS Simulator:     CAP_SERVER_URL=http://localhost:5173 pnpm cap sync ios
//   Android emulator:  adb reverse tcp:5173 tcp:5173, then CAP_SERVER_URL=http://localhost:5173 pnpm cap sync android
//   Phone on the LAN:  CAP_SERVER_URL=http://<Mac IP>:5173 (camera, mic and GPS need HTTPS there; car briefing works)
// Run the dev server with CARMORI_HTTP=1 so the WebView does not hit the self-signed certificate.
const serverUrl = process.env.CAP_SERVER_URL;

const config: CapacitorConfig = {
  appId: "com.carmori.app",
  appName: "Carmori",
  webDir: "dist",
  ...(serverUrl ? { server: { url: serverUrl, cleartext: serverUrl.startsWith("http:") } } : {}),
};

export default config;
