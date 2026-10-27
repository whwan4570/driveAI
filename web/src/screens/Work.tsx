// 시나리오 A: 고정 거치 카메라로 손·캡·병을 보고 자동 진행한다.
// 시작 전(투입구 위치 지정, 작업 시작)만 터치하고, 이후에는 행동과 음성으로만 진행한다.

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { api, type SessionView, type Step, type VoiceIntent, type WaitReason } from "../lib/api";
import { FULL_FRAME, openRearCamera, roiAround, type Roi } from "../lib/camera";
import { parseUtterance } from "../lib/commands";
import { WorkSessionController } from "../lib/workSession";
import { useUtterances, useVoice } from "../voiceContext";
import { Captions, type Caption } from "./Captions";

const STEP_LABEL: Record<Step, string> = {
  FIND_INLET: "투입구 찾기",
  OPEN_CAP: "캡 열기",
  CONFIRM_PRODUCT: "제품 확인",
  POUR: "보충 관찰",
  FINISH: "마무리",
  RECORDED: "기록 완료",
};

const WAIT_LABEL: Record<WaitReason, string> = {
  OCCLUDED: "가려짐 · 대기",
  WRONG_PART: "다른 부품 · 대기",
  CAP_ALREADY_OPEN: "캡이 이미 열림 · 대기",
  PRODUCT_CONFLICT: "제품 불일치 · 대기",
  PRODUCT_UNKNOWN: "라벨 확인 불가 · 대기",
  NEED_VOICE_CONFIRM: "음성 확인 대기",
};

export function Work({ vehicleId, onDone }: { vehicleId: string; onDone: () => void }) {
  const voice = useVoice();
  const videoRef = useRef<HTMLVideoElement>(null);
  const controllerRef = useRef<WorkSessionController | null>(null);
  const roiRef = useRef<Roi>(FULL_FRAME);
  const [roi, setRoi] = useState<Roi>(FULL_FRAME);
  const [session, setSession] = useState<SessionView | null>(null);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const add = (who: Caption["who"], text: string) => setCaptions((c) => [...c, { who, text }]);

  const say = async (text: string | null) => {
    if (!text) return;
    add("carmori", text);
    await voice.speak(text);
  };

  useEffect(() => {
    let stream: MediaStream | null = null;
    if (videoRef.current) {
      openRearCamera(videoRef.current)
        .then((s) => (stream = s))
        .catch(() => setError("카메라를 열지 못했어요."));
    }
    const onVisibility = () => controllerRef.current?.setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      controllerRef.current?.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const pickRoi = (e: MouseEvent<HTMLDivElement>) => {
    if (session) return; // 작업 시작 후에는 터치로 조작하지 않는다
    const rect = e.currentTarget.getBoundingClientRect();
    const next = roiAround((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
    roiRef.current = next;
    setRoi(next);
  };

  const start = async () => {
    const video = videoRef.current;
    if (!video) return;
    const update = await api.startSession(vehicleId);
    setSession(update.session);
    const controller = new WorkSessionController({
      video,
      getRoi: () => roiRef.current,
      sessionId: update.session.session_id,
      onUpdate: (u) => {
        setSession(u.session);
        void say(u.spoken_hint);
        if (u.session.step === "RECORDED") controller.stop();
      },
      onError: () => setError("연결이 불안정해요. 현재 단계에서 기다릴게요."),
    });
    controllerRef.current = controller;
    controller.start();
    await say(update.spoken_hint);
  };

  const sendIntent = async (sessionId: string, intent: VoiceIntent) => {
    controllerRef.current?.invalidateInFlight();
    const update = await api.voice(sessionId, intent);
    setSession(update.session);
    controllerRef.current?.setPaused(update.session.paused);
    if (intent === "RESTART") controllerRef.current?.start();
    await say(update.spoken_hint);
  };

  useUtterances(async (text) => {
    add("me", text);
    const parsed = parseUtterance(text);
    if (parsed.kind === "session" && session) {
      await sendIntent(session.session_id, parsed.intent);
      return;
    }
    if (parsed.kind === "question") {
      const answer = await api.ask(vehicleId, parsed.text);
      await say(answer.text);
    }
  });

  const step = session?.step;
  return (
    <div className="screen work">
      <div className="viewport" onClick={pickRoi}>
        <video ref={videoRef} playsInline muted />
        <div
          className="roi"
          style={{
            left: `${roi.x * 100}%`,
            top: `${roi.y * 100}%`,
            width: `${roi.w * 100}%`,
            height: `${roi.h * 100}%`,
          }}
        />
      </div>

      {!session ? (
        <>
          <p className="muted">휴대폰을 고정하고, 화면에서 투입구를 한 번 탭한 뒤 시작하세요.</p>
          <button className="primary" onClick={start}>
            작업 시작
          </button>
        </>
      ) : (
        <div className="status">
          <strong>{STEP_LABEL[session.step]}</strong>
          {session.waiting_reason && <span className="wait">{WAIT_LABEL[session.waiting_reason]}</span>}
          {session.paused && <span className="wait">일시정지</span>}
        </div>
      )}

      {error && <p className="error">{error}</p>}
      <Captions items={captions} />

      {session && step !== "RECORDED" && (
        <button className="ghost" onClick={() => void sendIntent(session.session_id, "PAUSE")}>
          중지 (보조)
        </button>
      )}
      {step === "RECORDED" && (
        <button className="primary" onClick={onDone}>
          돌아가기
        </button>
      )}
    </div>
  );
}
