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
