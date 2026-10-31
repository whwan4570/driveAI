import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { VoiceProvider } from "./voiceContext";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <VoiceProvider>
      <App />
    </VoiceProvider>
  </StrictMode>,
);

if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener("load", () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    });
  } else {
    // A worker left over from an earlier dev session can block or serve stale modules.
    void navigator.serviceWorker.getRegistrations().then((workers) => workers.forEach((worker) => void worker.unregister()));
    void caches.keys().then((names) => names.filter((name) => name.startsWith("carmori-app-")).forEach((name) => void caches.delete(name)));
  }
}
