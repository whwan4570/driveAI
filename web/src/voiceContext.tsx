import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { api } from "./lib/api";
import { VoiceIO } from "./lib/voice";

type Handler = (text: string) => void;

interface VoiceContextValue {
  voice: VoiceIO;
  setHandler: (handler: Handler | null) => void;
}

const VoiceContext = createContext<VoiceContextValue | null>(null);

export function VoiceProvider({ children }: { children: ReactNode }) {
  const handlerRef = useRef<Handler | null>(null);
  const valueRef = useRef<VoiceContextValue>();
  if (!valueRef.current) {
    const voice = new VoiceIO(async (wav) => {
      try {
        const text = await api.transcribe(wav);
        if (text.trim()) handlerRef.current?.(text);
      } catch (error) {
        console.warn("transcribe failed", error);
      }
    });
    valueRef.current = { voice, setHandler: (h) => (handlerRef.current = h) };
  }
  return <VoiceContext.Provider value={valueRef.current}>{children}</VoiceContext.Provider>;
}

export function useVoice(): VoiceIO {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error("VoiceProvider missing");
  return ctx.voice;
}

/** 현재 화면이 인식된 문장을 받는다. 화면이 바뀌면 핸들러도 바뀐다. */
export function useUtterances(handler: Handler) {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error("VoiceProvider missing");
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    ctx.setHandler((text) => latest.current(text));
    return () => ctx.setHandler(null);
  }, [ctx]);
}
