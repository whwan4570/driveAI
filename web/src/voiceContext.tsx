import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { api } from "./lib/api";
import { VoiceIO } from "./lib/voice";

type Handler = (text: string) => void;
type RecognitionIssue = "empty" | "unavailable";
type IssueHandler = (issue: RecognitionIssue) => void;

interface VoiceContextValue {
  voice: VoiceIO;
  setHandler: (handler: Handler | null, onIssue?: IssueHandler | null) => void;
}

const VoiceContext = createContext<VoiceContextValue | null>(null);

export function VoiceProvider({ children }: { children: ReactNode }) {
  const handlerRef = useRef<Handler | null>(null);
  const issueRef = useRef<IssueHandler | null>(null);
  const handlerGenerationRef = useRef(0);
  const valueRef = useRef<VoiceContextValue>();
  if (!valueRef.current) {
    const voice = new VoiceIO(async (wav) => {
      const generation = handlerGenerationRef.current;
      try {
        const text = await api.transcribe(wav);
        if (generation !== handlerGenerationRef.current) return;
        if (text.trim()) handlerRef.current?.(text.trim());
        else issueRef.current?.("empty");
      } catch (error) {
        console.warn("transcribe failed", error);
        if (generation !== handlerGenerationRef.current) return;
        issueRef.current?.("unavailable");
      }
    }, (text) => handlerRef.current?.(text));
    valueRef.current = { voice, setHandler: (h, onIssue = null) => {
      handlerGenerationRef.current += 1;
      handlerRef.current = h;
      issueRef.current = onIssue;
    } };
  }
  return <VoiceContext.Provider value={valueRef.current}>{children}</VoiceContext.Provider>;
}

export function useVoice(): VoiceIO {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error("VoiceProvider missing");
  return ctx.voice;
}

/** 현재 화면이 인식된 문장을 받는다. 화면이 바뀌면 핸들러도 바뀐다. */
export function useUtterances(handler: Handler, onIssue?: IssueHandler) {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error("VoiceProvider missing");
  const latest = useRef(handler);
  latest.current = handler;
  const latestIssue = useRef(onIssue);
  latestIssue.current = onIssue;
  useEffect(() => {
    ctx.setHandler((text) => latest.current(text), (issue) => latestIssue.current?.(issue));
    return () => ctx.setHandler(null);
  }, [ctx]);
}
