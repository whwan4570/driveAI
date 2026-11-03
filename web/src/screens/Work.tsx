// 고정 거치 카메라로 손·캡·병을 관찰한다. 세션 시작 후 단계는 서버 판정으로만 진행한다.
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Icon, Waveform } from "../components/Icons";
import { InletCue } from "../components/InletCue";
import { api, type InspectionResult, type SessionUpdate, type SessionView, type Step, type VoiceIntent, type WaitReason, type TransitionEvidence } from "../lib/api";
import { cameraFailureMessage, cameraFrameIsBlank, FULL_FRAME, grabGray, grabJpeg, openRearCamera, roiAround, type Roi } from "../lib/camera";
import { parseUtterance } from "../lib/commands";
import { WorkSessionController } from "../lib/workSession";
import { useUtterances, useVoice } from "../voiceContext";
import { Captions, type Caption } from "./Captions";

const STEPS: Record<Step, { title: string; instruction: string; number: number }> = {
  FIND_INLET: { title: "Find the inlet", instruction: "Show the washer cap and its narrow filler neck", number: 0 },
  OPEN_CAP: { title: "Open the cap", instruction: "Open the washer fluid cap", number: 1 },
  CONFIRM_PRODUCT: { title: "Check the product", instruction: "Show the bottle label to the camera", number: 2 },
  POUR: { title: "Refill washer fluid", instruction: "Tilt the bottle over the inlet and pour slowly", number: 3 },
  FINISH: { title: "Finish up", instruction: "Close the washer fluid cap and leave it in view", number: 4 },
  RECORDED: { title: "Saved to history", instruction: "Your washer fluid refill is on record", number: 4 },
};

const WAIT_MESSAGE: Record<WaitReason, string> = {
  OCCLUDED: "The inlet is blocked from view. Move your hand or the bottle aside.",
  WRONG_PART: "That may be a different part. Show the washer cap and its narrow filler neck.",
  CAP_ALREADY_OPEN: "I missed the cap before it opened. Show the cap in view.",
  PRODUCT_CONFLICT: "This isn't washer fluid. Show a washer-fluid bottle before pouring.",
  PRODUCT_UNKNOWN: "Move the product label closer, hold it still, and show the words that identify the fluid.",
  NEED_VOICE_CONFIRM: "Did you finish the refill? Say yes to save it, or use the confirmation below.",
};

type HandPoint = { x: number; y: number };
type HandMessage = { type: "ready" } | { type: "result"; hands: HandPoint[][] } | { type: "error"; message: string };
const HAND_CHAINS = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [5, 9, 10, 11, 12], [9, 13, 14, 15, 16], [13, 17, 18, 19, 20], [0, 17]];
// A small filler cap near an edge can be lost when the whole engine bay is resized.
const INLET_SEARCH_ROIS: Roi[] = [FULL_FRAME, { x: 0, y: 0.34, w: 0.62, h: 0.66 }, { x: 0.38, y: 0.34, w: 0.62, h: 0.66 }];

function boxInFullFrame(box: [number, number, number, number], crop: Roi): [number, number, number, number] {
  return [crop.x + box[0] * crop.w, crop.y + box[1] * crop.h, crop.x + box[2] * crop.w, crop.y + box[3] * crop.h];
}

export function Work({ vehicleId, voiceReady, onDone }: { vehicleId: string; voiceReady: boolean; onDone: () => void }) {
  const voice = useVoice();
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<WorkSessionController | null>(null);
  const commandQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingCommandsRef = useRef(0);
  const [commandPending, setCommandPending] = useState(false);
  const roiRef = useRef<Roi>(FULL_FRAME);
  const labelRoiRef = useRef<Roi>(FULL_FRAME);
  const stepRef = useRef<Step | null>(null);
  const roiSelectedRef = useRef(false);
  const [bottleChanged, setBottleChanged] = useState(false);
  const [roiSelected, setRoiSelected] = useState(false);
  // Where the inlet is in the camera frame (0–1): the tapped point, or the box found in a live capture.
  const [inletPoint, setInletPoint] = useState<{ x: number; y: number } | null>(null);
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [session, setSession] = useState<SessionView | null>(null);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const voiceErrorTimerRef = useRef<number | null>(null);
  const [cameraAvailable, setCameraAvailable] = useState(false);
  const [cameraOpening, setCameraOpening] = useState(true);
  const [cameraFailure, setCameraFailure] = useState<string | null>(null);
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const [demoMode, setDemoMode] = useState(false);
  const [visionStatus, setVisionStatus] = useState<string>("unverified");
  const [inspection, setInspection] = useState<InspectionResult | null>(null);
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [searchingInlet, setSearchingInlet] = useState(false);
  const [searchFinished, setSearchFinished] = useState(false);
  const [candidatePoint, setCandidatePoint] = useState<{ x: number; y: number } | null>(null);
  const hintRoiRef = useRef<Roi | null>(null);
  const [scanningLabel, setScanningLabel] = useState(false);
  const [labelRead, setLabelRead] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [hands, setHands] = useState<HandPoint[][]>([]);
  const [handTracking, setHandTracking] = useState<"loading" | "ready" | "unavailable">("loading");
  const [transitionMessage, setTransitionMessage] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<TransitionEvidence | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [observationStatus, setObservationStatus] = useState<string | null>(null);
  const [failurePaused, setFailurePaused] = useState(false);
  const failurePausedRef = useRef(false);
  const previousStepRef = useRef<Step | null>(null);
  const transitionTimerRef = useRef<number | null>(null);
  const add = (who: Caption["who"], text: string) => setCaptions((c) => [...c, { who, text }]);

  const say = async (text: string | null) => {
    if (!text) return;
    add("carmori", text);
    await voice.speak(text);
  };

  useEffect(() => {
    api.health().then((h) => { setDemoMode(h.demo_mode); setVisionStatus(h.vision_status); }).catch(() => { setVisionStatus("unavailable"); });
    const onVisibility = () => {
      if (document.hidden && controllerRef.current) {
        controllerRef.current.setPaused(true);
        failurePausedRef.current = true;
        setFailurePaused(true);
        setError("Guide paused while the app was in the background.");
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (transitionTimerRef.current !== null) window.clearTimeout(transitionTimerRef.current);
      if (voiceErrorTimerRef.current !== null) window.clearTimeout(voiceErrorTimerRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
      controllerRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    setCameraOpening(true);
    setCameraAvailable(false);
    setCameraFailure(null);
    // A small filler cap and its symbol need more pixels than the other camera views. Session frames still scale down.
    openRearCamera(video, { width: 1920, height: 1080 })
      .then((opened) => {
        if (cancelled) opened.getTracks().forEach((track) => track.stop());
        else {
          stream = opened;
          setCameraAvailable(true);
          setCameraOpening(false);
          if (video.videoWidth && video.videoHeight) setVideoSize({ width: video.videoWidth, height: video.videoHeight });
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setCameraAvailable(false);
          setCameraOpening(false);
          setCameraFailure(cameraFailureMessage(cause));
        }
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
      if (video.srcObject === stream) video.srcObject = null;
    };
  }, [cameraAttempt]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewportSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const worker = new Worker(new URL("../lib/handTracker.worker.ts", import.meta.url), { type: "module" });
    let active = true;
    let ready = false;
    let busy = false;
    worker.onmessage = (event: MessageEvent<HandMessage>) => {
      if (!active) return;
      const message = event.data;
      if (message.type === "ready") { ready = true; setHandTracking("ready"); return; }
      busy = false;
      if (message.type === "error") { ready = false; setHandTracking("unavailable"); setHands([]); return; }
      setHands(message.hands);
      if (roiSelectedRef.current) {
        const roi = roiRef.current;
        const margin = 0.07;
        const near = message.hands.some((hand) => [4, 8, 12, 16, 20].some((index) => {
          const point = hand[index];
          return point && point.x >= roi.x - margin && point.x <= roi.x + roi.w + margin && point.y >= roi.y - margin && point.y <= roi.y + roi.h + margin;
        }));
        controllerRef.current?.updateHandNearInlet(near);
      }
    };
    worker.onerror = () => { busy = false; ready = false; setHandTracking("unavailable"); };
    worker.postMessage({ type: "init" });
    const timer = window.setInterval(async () => {
      const video = videoRef.current;
      if (!active || !ready || busy || document.hidden || !video || video.readyState < 2) return;
      busy = true;
      try {
        const bitmap = await createImageBitmap(video);
        if (!active) { bitmap.close(); return; }
        worker.postMessage({ type: "frame", bitmap, timestamp: performance.now() }, [bitmap]);
      } catch { busy = false; ready = false; setHandTracking("unavailable"); }
    }, 160);
    return () => { active = false; window.clearInterval(timer); worker.terminate(); };
  }, []);

  const cover = videoSize.width && videoSize.height && viewportSize.width && viewportSize.height
    ? (() => {
        const scale = Math.max(viewportSize.width / videoSize.width, viewportSize.height / videoSize.height);
        const width = videoSize.width * scale;
        const height = videoSize.height * scale;
        return { width, height, offsetX: (width - viewportSize.width) / 2, offsetY: (height - viewportSize.height) / 2 };
      })()
    : null;

  // The on-screen label guide corresponds to a smaller part of the camera frame on a tall phone.
  // Capture that exact visible region so label letters survive image downscaling.
  if (cover) {
    const x1 = (viewportSize.width * 0.08 + cover.offsetX) / cover.width;
    const y1 = (viewportSize.height * 0.13 + cover.offsetY) / cover.height;
    const x2 = (viewportSize.width * 0.92 + cover.offsetX) / cover.width;
    const y2 = (viewportSize.height * 0.53 + cover.offsetY) / cover.height;
    labelRoiRef.current = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  useEffect(() => {
    const video = videoRef.current;
    // Demo Mode has no photo checks, so the inlet is tapped instead of searched.
    if (!video || !cameraAvailable || session || roiSelected || demoMode || visionStatus === "billing_required" || visionStatus === "unauthorized") return;
    let cancelled = false;
    let timer: number | undefined;
    let lastFrame: Uint8Array | null = null;
    let previousFrame: Uint8Array | null = null;
    let stable = 0;
    let running = false;
    let lastAttempt = 0;
    let scanIndex = 0;
    setSearchFinished(false);
    setCandidatePoint(null);
    const difference = (a: Uint8Array, b: Uint8Array) => a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) / a.length;
    const tick = async () => {
      if (cancelled || document.hidden || running || video.readyState < 2 || !video.videoWidth) return;
      let frame: Uint8Array;
      try {
        if (cameraFrameIsBlank(video)) return;
        frame = grabGray(video, FULL_FRAME, 48);
      } catch { return; }
      if (previousFrame && difference(frame, previousFrame) < 4) stable++; else stable = 0;
      previousFrame = frame;
      if (stable < 3 || performance.now() - lastAttempt < 4000) return;
      // A still view is searched once per crop: the full frame, then the lower left and right.
      // After a full pass, wait until the view changes (or the user taps) before searching again.
      if (!lastFrame || difference(frame, lastFrame) >= 8) scanIndex = 0;
      else if (scanIndex >= INLET_SEARCH_ROIS.length && !hintRoiRef.current) return;
      const fromHint = hintRoiRef.current !== null;
      running = true;
      lastAttempt = performance.now();
      lastFrame = frame;
      setSearchingInlet(true);
      setError(null);
      try {
        const searchRoi = hintRoiRef.current ?? INLET_SEARCH_ROIS[Math.min(scanIndex++, INLET_SEARCH_ROIS.length - 1)];
        hintRoiRef.current = null;
        const candidate = await api.analyzeInspection(vehicleId, { component: "washer_fluid", photo_type: "engine_candidate", jpeg_base64: grabJpeg(video, searchRoi, 1920, 0.85) });
        if (cancelled) return;
        if (difference(frame, grabGray(video, FULL_FRAME, 48)) > 8) { setCandidatePoint(null); lastFrame = null; return; }
        if (candidate.status === "unavailable") { setError(candidate.observation); setSearchFinished(true); return; }
        const box = candidate.box ? boxInFullFrame(candidate.box, searchRoi) : null;
        if (!box) { setCandidatePoint(null); setInspection(candidate); setSearchFinished(fromHint || scanIndex >= INLET_SEARCH_ROIS.length); return; }
        const point = { x: (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2 };
        setCandidatePoint(point);
        setInspection({ ...candidate, observation: "Checking the highlighted area. Hold still." });
        const crop = roiAround(point.x, point.y, 0.35);
        const firstTime = video.currentTime;
        const firstImage = grabJpeg(video, crop, 1920, 0.85);
        await new Promise<void>((resolve) => window.setTimeout(resolve, 500));
        if (cancelled || difference(frame, grabGray(video, FULL_FRAME, 48)) > 8) { setCandidatePoint(null); lastFrame = null; return; }
        if (video.currentTime <= firstTime) {
          setInspection({ ...candidate, observation: "Waiting for a new camera frame." });
          setSearchFinished(true);
          return;
        }
        const secondImage = grabJpeg(video, crop, 1920, 0.85);
        const results = await Promise.all([firstImage, secondImage].map((jpeg_base64) => api.analyzeInspection(vehicleId, {
          component: "washer_fluid", photo_type: "engine", jpeg_base64,
        })));
        if (cancelled) return;
        if (difference(frame, grabGray(video, FULL_FRAME, 48)) > 8) { setCandidatePoint(null); lastFrame = null; return; }
        const unavailable = results.find((result) => result.status === "unavailable");
        if (unavailable) { setError(unavailable.observation); setSearchFinished(true); return; }
        const verified = results.map((result) => result.box ? boxInFullFrame(result.box, crop) : null);
        if (results.some((result, index) => {
          const bounds = verified[index];
          return result.status !== "located" || !bounds || Math.abs((bounds[0] + bounds[2]) / 2 - point.x) > 0.12 || Math.abs((bounds[1] + bounds[3]) / 2 - point.y) > 0.12;
        })) {
          setInspection({ ...candidate, observation: "Move closer to the highlighted area." });
          setSearchFinished(true);
          return;
        }
        const [first, second] = verified;
        if (!first || !second || second[0] >= first[2] || second[2] <= first[0] || second[1] >= first[3] || second[3] <= first[1]) {
          setInspection({ ...candidate, observation: "The cap moved out of view. Hold still and try again." });
          setCandidatePoint(null);
          setSearchFinished(true);
          return;
        }
        const x = (second[0] + second[2]) / 2;
        const y = (second[1] + second[3]) / 2;
        roiRef.current = roiAround(x, y);
        roiSelectedRef.current = true;
        setInspection({ ...results[1], box: second });
        setCandidatePoint(null);
        setInletPoint({ x, y });
        setRoiSelected(true);
      } catch {
        if (!cancelled) { setError("Camera analysis is unavailable. Check your connection and try again."); setSearchFinished(true); }
      } finally {
        running = false;
        if (!cancelled) setSearchingInlet(false);
      }
    };
    timer = window.setInterval(() => { void tick(); }, 500);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
      // A cancelled search skips its own reset, e.g. when Demo Mode turns on mid-request.
      setSearchingInlet(false);
    };
  }, [vehicleId, cameraAvailable, session, roiSelected, demoMode, visionStatus, searchAttempt]);

  const pickRoi = (e: MouseEvent<HTMLDivElement>) => {
    if (session) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, cover ? (e.clientX - rect.left + cover.offsetX) / cover.width : (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, cover ? (e.clientY - rect.top + cover.offsetY) / cover.height : (e.clientY - rect.top) / rect.height));
    if (demoMode) {
      // Nothing can verify a tap in Demo Mode; the tapped point marks the inlet directly.
      roiRef.current = roiAround(x, y);
      roiSelectedRef.current = true;
      setInletPoint({ x, y });
      setRoiSelected(true);
      return;
    }
    hintRoiRef.current = roiAround(x, y);
    setCandidatePoint(null);
    setInspection(null);
    setSearchAttempt((n) => n + 1);
  };

  const applyUpdate = (u: SessionUpdate) => {
    setSession(u.session);
    if (u.session.step === "CONFIRM_PRODUCT") {
      const readable = u.windows.map((window) => window.answer?.label_text?.trim()).filter((label): label is string => !!label);
      setLabelRead(readable.at(-1)?.slice(0, 80) ?? null);
    } else {
      setLabelRead(null);
    }
    setBottleChanged(u.transition_reason === "bottle_changed");
    if (u.transition_event) {
      const message: Partial<Record<Step, string>> = {
        OPEN_CAP: "Inlet found",
        CONFIRM_PRODUCT: "Cap opened",
        POUR: "Bottle verified",
        FINISH: "Pour observed",
      };
      setEvidence(u.transition_event);
      setEvidenceOpen(false);
      setTransitionMessage(message[u.session.step] ?? (u.session.step === "RECORDED" ? "Refill recorded" : null));
      if (transitionTimerRef.current !== null) window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = window.setTimeout(() => setTransitionMessage(null), 2000);
    }
    previousStepRef.current = u.session.step;
    controllerRef.current?.setStateVersion(u.session.state_version);
    setObservationStatus(u.transition_reason === "awaiting_agreement" ? "Checking the observation" : null);
    if (["model_billing_required", "model_unauthorized", "model_error"].includes(u.transition_reason)) {
      controllerRef.current?.setPaused(true);
      failurePausedRef.current = true;
      setFailurePaused(true);
    }
    if (u.transition_reason === "model_billing_required") setError("Meta vision is blocked: this API key needs billing enabled. The camera cannot verify steps yet.");
    else if (u.transition_reason === "model_unauthorized") setError("Meta vision rejected this API key or model permission.");
    else if (u.transition_reason === "model_error") setError("Image analysis could not run. Try again or save completed work in History.");
    void say(u.spoken_hint);
    if (u.session.step === "RECORDED") controllerRef.current?.stop();
  };

  const scanLabel = async () => {
    setScanningLabel(true);
    setError(null);
    try {
      await controllerRef.current?.scanLabel();
    } catch {
      if (!failurePausedRef.current) setError("The label could not be checked. Try again.");
    } finally {
      setScanningLabel(false);
    }
  };

  const start = async () => {
    const video = videoRef.current;
    if (!video || starting) return;
    if (!video.videoWidth) { setError("A live camera is needed for hands-free guidance. Allow camera access and try again."); return; }
    if (!roiSelected || (!demoMode && inspection?.status !== "located")) { setError("First locate the inlet with a photo or tap the washer cap in the live view."); return; }
    setStarting(true);
    setError(null);
    try {
      const update = await api.startSession(vehicleId);
      setSession(update.session);
      previousStepRef.current = update.session.step;
      const controller = new WorkSessionController({
        video,
        // The bottle is held wherever the driver stands, so the label step cannot use the inlet crop.
        getRoi: () => stepRef.current === "CONFIRM_PRODUCT" ? labelRoiRef.current : roiRef.current,
        getMaxSide: () => stepRef.current === "CONFIRM_PRODUCT" ? 1600 : 768,
        sessionId: update.session.session_id,
        stateVersion: update.session.state_version,
        onUpdate: applyUpdate,
        onError: () => { controller.setPaused(true); failurePausedRef.current = true; setFailurePaused(true); setError("Connection lost. Guide paused at this step."); },
      });
      controllerRef.current = controller;
      controller.start();
      await say(update.spoken_hint);
    } catch {
      setError("Could not start the guide. Check the server connection.");
    } finally {
      setStarting(false);
    }
  };

  const sendIntent = (sessionId: string, intent: VoiceIntent, via: "voice" | "touch" = "voice") => {
    pendingCommandsRef.current++;
    setCommandPending(true);
    const run = async () => {
      try {
        controllerRef.current?.invalidateInFlight();
        const update = await api.voice(sessionId, intent, via);
        setSession(update.session);
        previousStepRef.current = update.session.step;
        controllerRef.current?.setStateVersion(update.session.state_version);
        controllerRef.current?.setPaused(update.session.paused || failurePausedRef.current);
        if (intent === "RESTART") controllerRef.current?.start();
        await say(update.spoken_hint);
      } catch {
        setError("I could not process that command. Please try again.");
      } finally {
        pendingCommandsRef.current--;
        if (pendingCommandsRef.current === 0) setCommandPending(false);
      }
    };
    const queued = commandQueueRef.current.then(run, run);
    commandQueueRef.current = queued;
    return queued;
  };

  useUtterances(async (text) => {
    if (voiceErrorTimerRef.current !== null) window.clearTimeout(voiceErrorTimerRef.current);
    setVoiceError(null);
    add("me", text);
    const parsed = parseUtterance(text);
    if (parsed.kind === "session" && session) {
      await sendIntent(session.session_id, parsed.intent);
      return;
    }
    if (parsed.kind === "question") {
      try {
        const answer = await api.ask(vehicleId, parsed.text, session?.session_id);
        await say(answer.text);
      } catch {
        setError("I could not get an answer. Please ask again.");
      }
    }
  }, (issue) => {
    if (!session) return;
    if (voiceErrorTimerRef.current !== null) window.clearTimeout(voiceErrorTimerRef.current);
    setVoiceError(issue === "empty" ? "I didn't catch that. Please try again." : "Voice transcription failed. Check your connection and try again.");
    if (issue === "empty") voiceErrorTimerRef.current = window.setTimeout(() => { setVoiceError(null); voiceErrorTimerRef.current = null; }, 3000);
  });

  useEffect(() => {
    if (roiSelected && (demoMode || inspection?.status === "located") && !session && !starting) void start();
  }, [roiSelected, inspection, session, demoMode]);

  const located = inspection?.status === "located" && inspection.box
    ? { x: (inspection.box[0] + inspection.box[2]) / 2, y: (inspection.box[1] + inspection.box[3]) / 2 } : null;
  const anchor = roiSelected && inletPoint ? inletPoint : located;

  stepRef.current = session?.step ?? null;
  const current = session ? STEPS[session.step] : null;
  const done = session?.step === "RECORDED";
  const waiting = session?.waiting_reason;
  const statusLabel = done ? "Task complete" : failurePaused ? "Guide paused" : session?.paused ? "Paused" : waiting === "NEED_VOICE_CONFIRM" ? "Waiting for your confirmation" : waiting === "PRODUCT_UNKNOWN" ? "Waiting for a readable label" : waiting === "PRODUCT_CONFLICT" ? (bottleChanged ? "Different bottle" : "Not washer fluid") : waiting ? "Waiting for a clear view" : observationStatus ?? (session ? (session.step === "OPEN_CAP" ? "Watching the cap" : "Watching automatically") : "Camera ready");
  const instruction = bottleChanged && waiting === "PRODUCT_CONFLICT" ? "That's a different bottle. Show its label." : waiting ? WAIT_MESSAGE[waiting] : current?.instruction ?? "Mount your phone with the washer fluid inlet in view";

  const visionBlocked = visionStatus === "billing_required" || visionStatus === "unauthorized";

  // The whole guide happens on the camera view: progress on top, the inlet cue in the scene, one card at the bottom.
  return <div className="app-shell work-shell"><main className="arw">
    <div className={`arw-viewport${session ? " session-active" : ""}`} ref={viewportRef} onClick={pickRoi}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        // Size the live preview with the same cover geometry used by the markers and label crop.
        // Safari can render a MediaStream with black side bars despite object-fit: cover.
        style={cover ? {
          left: -cover.offsetX,
          top: -cover.offsetY,
          right: "auto",
          bottom: "auto",
          width: cover.width,
          height: cover.height,
          objectFit: "fill",
        } : undefined}
        onLoadedMetadata={(e) => setVideoSize({ width: e.currentTarget.videoWidth, height: e.currentTarget.videoHeight })}
        onResize={(e) => setVideoSize({ width: e.currentTarget.videoWidth, height: e.currentTarget.videoHeight })}
      />
      {cover && hands.length > 0 && <svg className="hand-overlay" viewBox={`0 0 ${viewportSize.width} ${viewportSize.height}`} aria-hidden="true">
        {hands.flatMap((hand, handIndex) => [
          ...HAND_CHAINS.map((chain, chainIndex) => <path key={`h${handIndex}-c${chainIndex}`} d={chain.map((index, pointIndex) => {
            const point = hand[index];
            return `${pointIndex ? "L" : "M"}${(point.x * cover.width - cover.offsetX).toFixed(1)} ${(point.y * cover.height - cover.offsetY).toFixed(1)}`;
          }).join(" ")}/>),
          ...[4, 8, 12, 16, 20].map((index) => <circle key={`h${handIndex}-p${index}`} cx={hand[index].x * cover.width - cover.offsetX} cy={hand[index].y * cover.height - cover.offsetY} r="3.4"/>),
        ])}
      </svg>}
      {session?.step === "CONFIRM_PRODUCT" && <div className="arw-label-guide" aria-hidden="true"><span>Fill this frame with the label</span></div>}
      {candidatePoint && cameraAvailable && !session && <div aria-hidden="true" style={{ position: "absolute", left: cover ? candidatePoint.x * cover.width - cover.offsetX : `${candidatePoint.x * 100}%`, top: cover ? candidatePoint.y * cover.height - cover.offsetY : `${candidatePoint.y * 100}%`, width: 64, height: 64, border: "3px dashed white", borderRadius: "50%", transform: "translate(-50%, -50%)", pointerEvents: "none" }}/>}
      {anchor && cameraAvailable && <InletCue
        left={cover ? anchor.x * cover.width - cover.offsetX : `${anchor.x * 100}%`}
        top={cover ? anchor.y * cover.height - cover.offsetY : `${anchor.y * 100}%`}
        step={session?.step ?? null} waiting={session?.waiting_reason} paused={!!session?.paused}/>}
    </div>

    <header className="arw-top">
      <button type="button" className="arw-icon" aria-label="Close guide" onClick={onDone}><Icon name="close" size={22}/></button>
      <div className="arw-progress" aria-label={current && current.number > 0 ? `Step ${current.number} of 4` : "Setup"}>
        <strong>{current && current.number > 0 ? `${current.number}/4 · ${current.title}` : current?.title ?? "Washer fluid refill"}</strong>
        <div className="arw-progress-track">{[1, 2, 3, 4].map((n) => <i key={n} className={current && (done || current.number >= n) ? "filled" : ""}/>)}</div>
      </div>
      {session && !done && <button type="button" className="arw-pause" onClick={() => void sendIntent(session.session_id, session.paused ? "RESUME" : "PAUSE", "touch")} disabled={commandPending} aria-label={session.paused ? "Resume guide" : "Pause guide"}><Icon name={session.paused ? "play" : "pause"} size={18}/></button>}
      <span className="arw-live"><span/>{demoMode ? "DEMO" : "LIVE"}</span>
    </header>
    {(transitionMessage || evidenceOpen) && evidence && <button type="button" className="arw-transition" onClick={() => setEvidenceOpen(!evidenceOpen)} aria-expanded={evidenceOpen}><Icon name="check" size={19}/>{transitionMessage ?? "Observation confirmed"}<span>Details</span></button>}
    {evidenceOpen && evidence && <div className="arw-evidence" role="status"><strong>{evidence.simulated ? "Simulated observation" : "Camera observation confirmed"}</strong><p>{evidence.condition === "cap_opened" ? "Open cap detected in two separate observations." : evidence.condition === "inlet_found" ? "Inlet and closed cap detected in two separate observations." : evidence.condition === "product_matched" ? "Product matched in two separate observations." : evidence.condition === "pour_observed" ? "Bottle position and tilt detected in two separate observations." : "Completion conditions detected in two separate observations."}</p><small>{evidence.simulated ? "Demo mode" : `Camera analysis · ${evidence.model_version}`}</small></div>}
    {cameraAvailable && handTracking === "ready" && hands.length > 0 && <span className="arw-hands">Hands in view</span>}

    <div className="arw-bottom">
      {captions.length > 0 && session && <div className="arw-captions"><Captions items={captions.slice(-2)}/></div>}
      {error && <div className="arw-error" role="alert">{error}</div>}
      {voiceError && <div className="arw-error" role="alert">{voiceError}</div>}

      <section className={`arw-card${!session && cameraAvailable && !visionBlocked ? " is-setup" : ""}${waiting ? " is-waiting" : ""}${done ? " is-done" : ""}`} aria-live="polite">
        {!session ? !cameraAvailable ? <>
          <h1>{cameraOpening ? "Starting camera…" : "The camera could not start"}</h1>
          <p>{cameraOpening ? "Waiting for your camera." : cameraFailure ?? "Check camera access and try again."}</p>
          {!cameraOpening && <div className="arw-actions">
            <button type="button" className="arw-secondary" onClick={onDone}>Back</button>
            <button type="button" className="arw-primary" onClick={() => setCameraAttempt((attempt) => attempt + 1)}>Try camera again</button>
          </div>}
        </> : visionBlocked ? <>
          <h1>Camera guidance is unavailable</h1>
          <p>Use your vehicle manual to find the cap and check the label. You can save a finished refill from History.</p>
          <button type="button" className="arw-primary" onClick={onDone}>Back to my car</button>
        </> : <>
          <span className="arw-status"><span className="arw-dot"/>{anchor ? "Inlet marked" : "Camera setup"}</span>
          <h1>{anchor ? "Washer cap found" : !videoSize.width ? "Starting camera…" : searchingInlet ? "Looking for the washer cap…" : searchFinished ? "I couldn't locate the cap" : "Show me the engine bay"}</h1>
          <p>{anchor ? "Starting the guide…" : demoMode ? "Tap the washer cap to start the demo." : "Show the whole engine bay. I’ll find the washer cap."}</p>
          {searchingInlet && <p className="arw-note" role="status">Looking for the washer fluid cap… {inspection?.status === "uncertain" ? ` · ${inspection.observation}` : ""}</p>}
          {inspection && !searchingInlet && <p className={`arw-note ${inspection.status}`}>{inspection.observation}</p>}
          {searchFinished && !anchor && <p className="arw-note">Move the phone to search again.</p>}
          <div className="arw-actions">
            <button type="button" className="arw-secondary" onClick={() => { setError(null); setInspection(null); setSearchAttempt((n) => n + 1); }} disabled={searchingInlet || !!anchor}><Icon name="camera" size={18}/>Look again</button>
            {anchor && error && <button type="button" className="arw-primary" onClick={() => void start()} disabled={starting}>Try starting again</button>}

          </div>
          {demoMode && <p className="arw-note">Demo mode simulates step observations. It does not verify real camera actions.</p>}
        </> : done ? <>
          <span className="arw-status is-done"><Icon name="check" size={16}/>Saved to history</span>
          <h1>Washer fluid refill recorded</h1>
          <button type="button" className="arw-primary" onClick={onDone}>Back to my car</button>
        </> : <>
          <div className="arw-card-top">
            <span className="arw-status"><span className={`arw-dot${!session.paused ? " pulsing" : ""}`}/>{statusLabel}</span>
          </div>
          <h1>{instruction}</h1>
          {session.paused ? <button type="button" className="arw-primary is-wide" onClick={() => void sendIntent(session.session_id, "RESUME", "touch")} disabled={commandPending}>Resume guide</button>
          : failurePaused ? <button type="button" className="arw-secondary is-wide" onClick={() => { setError(null); failurePausedRef.current = false; setFailurePaused(false); controllerRef.current?.setPaused(false); }}>Try again</button>
          : waiting === "NEED_VOICE_CONFIRM" ? <div className="arw-actions">
            <button type="button" className="arw-secondary" onClick={() => void sendIntent(session.session_id, "CONFIRM_NO", "touch")}>Not yet</button>
            <button type="button" className="arw-primary" onClick={() => void sendIntent(session.session_id, "CONFIRM_YES", "touch")}>Yes, refilled</button>
          </div> : session.step === "CONFIRM_PRODUCT" ? <>
            {labelRead && <p className="arw-note" role="status">Read: “{labelRead}”</p>}
            <button type="button" className="arw-secondary is-wide" onClick={() => void scanLabel()} disabled={scanningLabel || session.paused}><Icon name="camera" size={18}/>{scanningLabel ? "Hold it steady…" : "Scan label now"}</button>
          </> : <div className="arw-voice"><Waveform active={voiceReady && !session.paused}/><span>{voiceReady ? "Say ‘repeat that’ or ask a question" : "Voice is off. The camera keeps guiding."}</span></div>}
        </>}
      </section>
    </div>
  </main></div>;
}
