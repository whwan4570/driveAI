import { useEffect, useState } from "react";
import { api } from "./lib/api";
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
  const start = async () => {
    if (started) return;
    voice.unlockTts();
    await voice.startListening();
    setVoiceReady(true);
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
    try {
      await start();
    } catch (error) {
      // 마이크가 막혀도 카메라 관찰 안내는 진행할 수 있다.
      console.warn("Voice input unavailable", error);
      setVoiceReady(false);
    }
    setScreen("work");
  };

  return screen === "home" ? (
    <Home vehicleId={vehicleId} started={started} onStart={start} onStop={stop} onStartTask={startTask} />
  ) : (
    <Work vehicleId={vehicleId} voiceReady={voiceReady} onDone={() => setScreen("home")} />
  );
}
