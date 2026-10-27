import { useState } from "react";
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
    voice.unlockTts();
    await voice.startListening();
    try {
      await navigator.wakeLock?.request("screen");
    } catch {
      // 지원하지 않는 브라우저에서는 화면 꺼짐 시 세션이 대기한다.
    }
    setStarted(true);
  };

  return screen === "home" ? (
    <Home vehicleId={vehicleId} started={started} onStart={start} onStartTask={() => setScreen("work")} />
  ) : (
    <Work vehicleId={vehicleId} onDone={() => setScreen("home")} />
  );
}
