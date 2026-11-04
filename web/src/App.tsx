import { useEffect, useState } from "react";
import { api } from "./lib/api";
import { readPermissionSettings } from "./lib/permissions";
import { Home } from "./screens/Home";
import { Setup } from "./screens/Setup";
import { Work } from "./screens/Work";
import { useVoice } from "./voiceContext";

const VEHICLE_KEY = "carmori.vehicleId";

function readVehicleId(): string | null {
  try {
    return localStorage.getItem(VEHICLE_KEY);
  } catch {
    return null;
  }
}

type Screen = "home" | "work";

export function App() {
  const voice = useVoice();
  const [vehicleId, setVehicleId] = useState<string | null>(readVehicleId);
  const [screen, setScreen] = useState<Screen>("home");
  const [started, setStarted] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false);
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowSplash(false), 1500);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!vehicleId) return;
    let active = true;
    api.vehicle(vehicleId).catch((error: unknown) => {
      if (!active || !(error instanceof Error) || !error.message.endsWith(" 404")) return;
      try { localStorage.removeItem(VEHICLE_KEY); } catch { /* Continue in memory. */ }
      setVehicleId(null);
    });
    return () => { active = false; };
  }, [vehicleId]);

  if (showSplash) {
    return <main className="carmori-splash" aria-label="Carmori"><h1>Carmori<span>.</span></h1></main>;
  }

  if (!vehicleId) {
    return (
      <Setup
        onRegistered={(id) => {
          try {
            localStorage.setItem(VEHICLE_KEY, id);
          } catch {
            // 저장이 막혀도 이번 실행에서는 계속 쓴다.
          }
          setVehicleId(id);
        }}
      />
    );
  }

  // 처음 한 번의 터치로 TTS·마이크·화면 유지를 켠다. 이후에는 음성과 동작으로 진행한다.
  const start = async (ttsAlreadyStarted = false) => {
    if (started) return;
    if (!ttsAlreadyStarted) voice.unlockTts();
    // With the microphone off in Settings the guide still runs; it just takes taps instead of voice.
    const micAllowed = readPermissionSettings().microphone;
    if (micAllowed) await voice.startListening();
    setVoiceReady(micAllowed);
    try {
      await navigator.wakeLock?.request("screen");
    } catch {
      // 지원하지 않는 브라우저에서는 화면 꺼짐 시 세션이 대기한다.
    }
    setStarted(true);
  };

  const stop = async () => {
    voice.cancelSpeech();
    await voice.stopListening();
    setVoiceReady(false);
    setStarted(false);
  };

  const startTask = async () => {
    // Start audible guidance in the user's tap. iOS Safari may block speech
    // first requested after camera setup and the server round trip.
    void voice.speak("Show the whole engine bay. I'll find the washer cap.");
    setScreen("work");
    try {
      await start(true);
    } catch (error) {
      // 마이크가 막혀도 카메라 관찰 안내는 진행할 수 있다.
      console.warn("Voice input unavailable", error);
      setVoiceReady(false);
    }
  };

  return screen === "home" ? (
    <Home vehicleId={vehicleId} started={started} onStart={start} onStop={stop} onStartTask={startTask} />
  ) : (
    <Work vehicleId={vehicleId} voiceReady={voiceReady} onDone={() => setScreen("home")} />
  );
}
