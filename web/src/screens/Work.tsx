// 고정 거치 카메라로 손·캡·병을 관찰한다. 세션 시작 후 단계는 서버 판정으로만 진행한다.
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Icon, Waveform } from "../components/Icons";
import { InletCue } from "../components/InletCue";
import { api, type InspectionResult, type SessionUpdate, type SessionView, type Step, type VoiceIntent, type WaitReason, type TransitionEvidence } from "../lib/api";
import { FULL_FRAME, grabJpeg, openRearCamera, roiAround, type Roi } from "../lib/camera";
import { parseUtterance } from "../lib/commands";
import { WorkSessionController } from "../lib/workSession";
import { useUtterances, useVoice } from "../voiceContext";
import { Captions, type Caption } from "./Captions";

const STEPS: Record<Step, { title: string; instruction: string; number: number }> = {
  FIND_INLET: { title: "Find the inlet", instruction: "Show the washer cap and its narrow filler neck", number: 0 },
  OPEN_CAP: { title: "Open the cap", instruction: "Open the washer fluid cap", number: 1 },
  CONFIRM_PRODUCT: { title: "Check the product", instruction: "Show the bottle label to the camera", number: 2 },
  POUR: { title: "Refill washer fluid", instruction: "Tilt the bottle over the inlet and pour slowly", number: 3 },
  FINISH: { title: "Finish up", instruction: "Set the bottle upright and close the cap", number: 4 },
  RECORDED: { title: "Saved to history", instruction: "Your washer fluid refill is on record", number: 4 },
};

const WAIT_MESSAGE: Record<WaitReason, string> = {
  OCCLUDED: "The inlet is blocked from view. Move your hand or the bottle aside.",
  WRONG_PART: "That may be a different part. Show the washer cap and its narrow filler neck.",
  CAP_ALREADY_OPEN: "I missed the cap before it opened. Show the cap in view.",
  PRODUCT_CONFLICT: "This isn't washer fluid. Don't pour it.",
  PRODUCT_UNKNOWN: "I cannot read the label. Point the front of the bottle at the camera.",
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
  const roiRef = useRef<Roi>(FULL_FRAME);
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
  const [cameraAvailable, setCameraAvailable] = useState(true);
  const [demoMode, setDemoMode] = useState(false);
  const [visionStatus, setVisionStatus] = useState<string>("unverified");
  const [inspection, setInspection] = useState<InspectionResult | null>(null);
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [searchingInlet, setSearchingInlet] = useState(false);
  const [searchFinished, setSearchFinished] = useState(false);
  const [searchPass, setSearchPass] = useState(0);
  const [scanningLabel, setScanningLabel] = useState(false);
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
    let stream: MediaStream | null = null;
    let cancelled = false;
    if (videoRef.current) {
      // A small filler cap and its symbol need more pixels than the other camera views. Session frames still scale down.
      openRearCamera(videoRef.current, { width: 1920, height: 1080 })
        .then((s) => {
          if (cancelled) s.getTracks().forEach((t) => t.stop());
          else {
            stream = s;
            const video = videoRef.current;
            if (video?.videoWidth && video.videoHeight) setVideoSize({ width: video.videoWidth, height: video.videoHeight });
          }
        })
        .catch(() => { if (!cancelled) setCameraAvailable(false); });
    }
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
      cancelled = true;
      if (transitionTimerRef.current !== null) window.clearTimeout(transitionTimerRef.current);
      if (voiceErrorTimerRef.current !== null) window.clearTimeout(voiceErrorTimerRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
      controllerRef.current?.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

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

  useEffect(() => {
    const video = videoRef.current;
    // The first successful inspection changes vision_status from unverified to ready.
    // Blocking unverified here prevents that first request from ever happening.
    if (!video || !cameraAvailable || session || roiSelected || visionStatus === "billing_required" || visionStatus === "unauthorized") return;
    let cancelled = false;
    let timer: number | undefined;
    let count = 0;
    let frameWaits = 0;
    setSearchFinished(false);
    setSearchPass(0);
    const search = async () => {
      if (cancelled) return;
      if (document.hidden) { timer = window.setTimeout(search, 1000); return; }
      if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
        if (++frameWaits >= 12) {
          setError("The camera opened, but no video frames arrived. Close and reopen the guide.");
          setSearchFinished(true);
          return;
        }
        timer = window.setTimeout(search, 1000);
        return;
      }
      setVideoSize((size) => size.width === video.videoWidth && size.height === video.videoHeight ? size : { width: video.videoWidth, height: video.videoHeight });
      count += 1;
      setSearchPass(count);
      setSearchingInlet(true);
      try {
        const searchRoi = INLET_SEARCH_ROIS[count - 1];
        const result = await api.analyzeInspection(vehicleId, { component: "washer_fluid", photo_type: "engine", jpeg_base64: grabJpeg(video, searchRoi, 1920, 0.78) });
        if (cancelled) return;
        const fullBox = result.box ? boxInFullFrame(result.box, searchRoi) : null;
        setInspection({ ...result, box: fullBox });
        if (result.status === "located" && fullBox) {
          const x = (fullBox[0] + fullBox[2]) / 2;
          const y = (fullBox[1] + fullBox[3]) / 2;
          const next = roiAround(x, y);
          roiRef.current = next;
          roiSelectedRef.current = true;
          setInletPoint({ x, y });
          setRoiSelected(true);
          setSearchingInlet(false);
          return;
        }
        if (result.status === "unavailable") { setError(result.observation); setSearchFinished(true); return; }
      } catch {
        if (!cancelled) { setError("Camera analysis is unavailable. Check your connection and try again."); setSearchFinished(true); }
        return;
      } finally {
        if (!cancelled) setSearchingInlet(false);
      }
      if (!cancelled && count < INLET_SEARCH_ROIS.length) timer = window.setTimeout(search, 4000);
      else if (!cancelled) setSearchFinished(true);
    };
    void search();
    return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [vehicleId, cameraAvailable, session, roiSelected, visionStatus, searchAttempt]);

  const pickRoi = (e: MouseEvent<HTMLDivElement>) => {
    if (session) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = cover ? (e.clientX - rect.left + cover.offsetX) / cover.width : (e.clientX - rect.left) / rect.width;
    const y = cover ? (e.clientY - rect.top + cover.offsetY) / cover.height : (e.clientY - rect.top) / rect.height;
    const next = roiAround(x, y);
    setInletPoint({ x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) });
    roiRef.current = next;
    roiSelectedRef.current = true;
    setRoiSelected(true);
    setSearchingInlet(false);
  };

  const applyUpdate = (u: SessionUpdate) => {
    setSession(u.session);
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
      setError("The label could not be checked. Try again.");
    } finally {
      setScanningLabel(false);
    }
  };

  const start = async () => {
    const video = videoRef.current;
    if (!video || starting) return;
    if (!video.videoWidth) { setError("A live camera is needed for hands-free guidance. Allow camera access and try again."); return; }
    if (inspection?.status !== "located" && !roiSelected) { setError("First locate the inlet with a photo or tap the washer cap in the live view."); return; }
    setStarting(true);
    setError(null);
    try {
      const update = await api.startSession(vehicleId);
      setSession(update.session);
      previousStepRef.current = update.session.step;
      const controller = new WorkSessionController({
        video,
        // The bottle is held wherever the driver stands, so the label step cannot use the inlet crop.
        getRoi: () => stepRef.current === "CONFIRM_PRODUCT" ? FULL_FRAME : roiRef.current,
        getMaxSide: () => stepRef.current === "CONFIRM_PRODUCT" ? 1280 : 768,
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

  const sendIntent = async (sessionId: string, intent: VoiceIntent, via: "voice" | "touch" = "voice") => {
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
    }
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
      <video ref={videoRef} playsInline muted onLoadedMetadata={(e) => setVideoSize({ width: e.currentTarget.videoWidth, height: e.currentTarget.videoHeight })}/>
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
      {session && !done && <button type="button" className="arw-pause" onClick={() => void sendIntent(session.session_id, session.paused ? "RESUME" : "PAUSE", "touch")} aria-label={session.paused ? "Resume guide" : "Pause guide"}><Icon name={session.paused ? "play" : "pause"} size={18}/></button>}
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
          <h1>The guide needs the camera</h1>
          <p>It watches the washer inlet live. Allow camera access, then open the guide again.</p>
          <button type="button" className="arw-primary" onClick={onDone}>Back to my car</button>
        </> : visionBlocked ? <>
          <h1>Camera guidance is unavailable</h1>
          <p>Use your vehicle manual to find the cap and check the label. You can save a finished refill from History.</p>
          <button type="button" className="arw-primary" onClick={onDone}>Back to my car</button>
        </> : <>
          <span className="arw-status"><span className="arw-dot"/>{anchor ? "Inlet marked" : "Camera setup"}</span>
          <h1>{anchor ? "Keep the phone still and start" : !videoSize.width ? "Starting camera…" : searchingInlet ? "Looking for the washer cap…" : searchFinished ? "I couldn't locate the cap" : "Show me the engine bay"}</h1>
          <p>{anchor ? "Check the washer symbol on the marked cap." : "I'll look for the cap, or tap it on screen."}</p>
          {searchingInlet && <p className="arw-note" role="status">Looking for the washer fluid cap… {searchPass > 0 ? `${searchPass} of ${INLET_SEARCH_ROIS.length}` : ""}</p>}
          {inspection && !searchingInlet && <p className={`arw-note ${inspection.status}`}>{inspection.observation}</p>}
          {searchFinished && !anchor && <p className="arw-note">Move closer or try another angle.</p>}
          <div className="arw-actions">
            <button type="button" className="arw-secondary" onClick={() => { setError(null); setInspection(null); setSearchAttempt((n) => n + 1); }} disabled={searchingInlet}><Icon name="camera" size={18}/>Look again</button>
            <button type="button" className="arw-primary" onClick={() => void start()} disabled={starting || !anchor}>{starting ? "Starting…" : "Start guide"}</button>
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
          {failurePaused && <button type="button" className="arw-secondary is-wide" onClick={() => { setError(null); failurePausedRef.current = false; setFailurePaused(false); controllerRef.current?.setPaused(session.paused); }}>Try again</button>}
          {waiting === "NEED_VOICE_CONFIRM" ? <div className="arw-actions">
            <button type="button" className="arw-secondary" onClick={() => void sendIntent(session.session_id, "CONFIRM_NO", "touch")}>Not yet</button>
            <button type="button" className="arw-primary" onClick={() => void sendIntent(session.session_id, "CONFIRM_YES", "touch")}>Yes, refilled</button>
          </div> : session.step === "CONFIRM_PRODUCT" ? <>
            <button type="button" className="arw-secondary is-wide" onClick={() => void scanLabel()} disabled={scanningLabel || session.paused}><Icon name="camera" size={18}/>{scanningLabel ? "Hold it steady…" : "Scan label now"}</button>
          </> : <div className="arw-voice"><Waveform active={voiceReady && !session.paused}/><span>{voiceReady ? "Say ‘repeat that’ or ask a question" : "Voice is off. The camera keeps guiding."}</span></div>}
        </>}
      </section>
    </div>
  </main></div>;
}
