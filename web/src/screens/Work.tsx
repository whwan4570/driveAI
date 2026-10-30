// 고정 거치 카메라로 손·캡·병을 관찰한다. 세션 시작 후 단계는 서버 판정으로만 진행한다.
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Icon, Waveform } from "../components/Icons";
import { InletCue } from "../components/InletCue";
import { api, type InspectionResult, type SessionView, type Step, type VoiceIntent, type WaitReason } from "../lib/api";
import { FULL_FRAME, grabJpeg, openRearCamera, roiAround, type Roi } from "../lib/camera";
import { parseUtterance } from "../lib/commands";
import { photoFromFile } from "../lib/photos";
import { WorkSessionController } from "../lib/workSession";
import { useUtterances, useVoice } from "../voiceContext";
import { Captions, type Caption } from "./Captions";

const STEPS: Record<Step, { title: string; instruction: string; number: number }> = {
  FIND_INLET: { title: "Find the inlet", instruction: "Show the blue cap with the windshield symbol", number: 0 },
  OPEN_CAP: { title: "Open the cap", instruction: "Open the washer fluid cap", number: 1 },
  CONFIRM_PRODUCT: { title: "Check the product", instruction: "Show the bottle label to the camera", number: 2 },
  POUR: { title: "Refill washer fluid", instruction: "Tilt the bottle over the inlet and pour slowly", number: 3 },
  FINISH: { title: "Finish up", instruction: "Set the bottle upright and close the cap", number: 4 },
  RECORDED: { title: "Saved to history", instruction: "Your washer fluid refill is on record", number: 4 },
};

const WAIT_MESSAGE: Record<WaitReason, string> = {
  OCCLUDED: "The inlet is blocked from view. Move your hand or the bottle aside.",
  WRONG_PART: "That may be a different part. Show the cap with the windshield symbol.",
  CAP_ALREADY_OPEN: "I missed the cap before it opened. Show the cap in view.",
  PRODUCT_CONFLICT: "I could not verify this as washer fluid. Show the label again.",
  PRODUCT_UNKNOWN: "I cannot read the label. Point the front of the bottle at the camera.",
  NEED_VOICE_CONFIRM: "Did you finish the refill? Say yes to save it, or use the confirmation below.",
};

type HandPoint = { x: number; y: number };
type HandMessage = { type: "ready" } | { type: "result"; hands: HandPoint[][] } | { type: "error"; message: string };
const HAND_CHAINS = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [5, 9, 10, 11, 12], [9, 13, 14, 15, 16], [13, 17, 18, 19, 20], [0, 17]];

export function Work({ vehicleId, voiceReady, onDone }: { vehicleId: string; voiceReady: boolean; onDone: () => void }) {
  const voice = useVoice();
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<WorkSessionController | null>(null);
  const roiRef = useRef<Roi>(FULL_FRAME);
  const roiSelectedRef = useRef(false);
  const [roi, setRoi] = useState<Roi>(FULL_FRAME);
  const [roiSelected, setRoiSelected] = useState(false);
  // Where the inlet is in the camera frame (0–1): the tapped point, or the box from a live capture.
  const [inletPoint, setInletPoint] = useState<{ x: number; y: number } | null>(null);
  const [previewFromLive, setPreviewFromLive] = useState(false);
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [session, setSession] = useState<SessionView | null>(null);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [cameraAvailable, setCameraAvailable] = useState(true);
  const [demoMode, setDemoMode] = useState(false);
  const [visionStatus, setVisionStatus] = useState<string>("unverified");
  const [preview, setPreview] = useState<string | null>(null);
  const [inspection, setInspection] = useState<InspectionResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [productInspection, setProductInspection] = useState<InspectionResult | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const productInputRef = useRef<HTMLInputElement>(null);
  const [starting, setStarting] = useState(false);
  const [lastHint, setLastHint] = useState<string | null>(null);
  const [hands, setHands] = useState<HandPoint[][]>([]);
  const [handTracking, setHandTracking] = useState<"loading" | "ready" | "unavailable">("loading");
  const add = (who: Caption["who"], text: string) => setCaptions((c) => [...c, { who, text }]);

  const say = async (text: string | null) => {
    if (!text) return;
    add("carmori", text);
    setLastHint(text);
    await voice.speak(text);
  };

  useEffect(() => {
    api.health().then((h) => { setDemoMode(h.demo_mode); setVisionStatus(h.vision_status); }).catch(() => undefined);
    let stream: MediaStream | null = null;
    let cancelled = false;
    if (videoRef.current) {
      openRearCamera(videoRef.current)
        .then((s) => {
          if (cancelled) s.getTracks().forEach((t) => t.stop());
          else stream = s;
        })
        .catch(() => { if (!cancelled) { setCameraAvailable(false); setError("Camera access is unavailable. Upload a photo to locate the washer inlet."); } });
    }
    const onVisibility = () => controllerRef.current?.setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
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

  const pickRoi = (e: MouseEvent<HTMLDivElement>) => {
    if (session) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = cover ? (e.clientX - rect.left + cover.offsetX) / cover.width : (e.clientX - rect.left) / rect.width;
    const y = cover ? (e.clientY - rect.top + cover.offsetY) / cover.height : (e.clientY - rect.top) / rect.height;
    const next = roiAround(x, y);
    setInletPoint({ x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) });
    roiRef.current = next;
    roiSelectedRef.current = true;
    setRoi(next);
    setRoiSelected(true);
  };

  const analyzePhoto = async (base64: string, photoType: "engine" | "product") => {
    if (photoType === "engine") { setPreview(`data:image/jpeg;base64,${base64}`); setInspection(null); }
    else setProductInspection(null);
    setAnalyzing(true);
    setError(null);
    try {
      const result = await api.analyzeInspection(vehicleId, { component: "washer_fluid", photo_type: photoType, jpeg_base64: base64 });
      if (photoType === "engine") setInspection(result);
      else setProductInspection(result);
      if (result.status === "unavailable") setError(result.observation);
      else if (result.status === "uncertain") void say(result.observation);
    } catch { setError("Image analysis failed. Retry the photo or use your vehicle manual."); }
    finally { setAnalyzing(false); }
  };

  const capture = () => {
    if (!videoRef.current?.videoWidth) { setError("Camera is not ready. Upload a photo instead."); return; }
    setPreviewFromLive(true);
    void analyzePhoto(grabJpeg(videoRef.current, FULL_FRAME, 1600, 0.78), "engine");
  };

  const upload = async (file: File | undefined, photoType: "engine" | "product") => {
    if (!file) return;
    if (photoType === "engine") setPreviewFromLive(false);
    try { await analyzePhoto(await photoFromFile(file), photoType); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not read the photo."); }
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
      const controller = new WorkSessionController({
        video,
        getRoi: () => roiRef.current,
        sessionId: update.session.session_id,
        stateVersion: update.session.state_version,
        onUpdate: (u) => {
          setSession(u.session);
          controllerRef.current?.setStateVersion(u.session.state_version);
          if (u.transition_reason === "model_billing_required") setError("Meta vision is blocked: this API key needs billing enabled. The camera cannot verify steps yet.");
          else if (u.transition_reason === "model_unauthorized") setError("Meta vision rejected this API key or model permission.");
          else if (u.transition_reason === "model_error") setError("Image analysis could not run. Try again or save completed work in History.");
          void say(u.spoken_hint);
          if (u.session.step === "RECORDED") controller.stop();
        },
        onError: () => setError("Connection is unstable. I will wait at this step."),
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
      controllerRef.current?.setStateVersion(update.session.state_version);
      controllerRef.current?.setPaused(update.session.paused);
      if (intent === "RESTART") controllerRef.current?.start();
      await say(update.spoken_hint);
    } catch {
      setError("I could not process that command. Please try again.");
    }
  };

  useUtterances(async (text) => {
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
  }, (issue) => setVoiceError(issue === "empty" ? "I didn't catch that. Please try again." : "Voice transcription failed. Check your connection and try again."));

  const located = previewFromLive && inspection?.status === "located" && inspection.box
    ? { x: (inspection.box[0] + inspection.box[2]) / 2, y: (inspection.box[1] + inspection.box[3]) / 2 } : null;
  const anchor = roiSelected && inletPoint ? inletPoint : located;

  const current = session ? STEPS[session.step] : null;
  const done = session?.step === "RECORDED";
  const waiting = session?.waiting_reason;
  const statusLabel = done ? "Task complete" : session?.paused ? "Paused" : waiting === "NEED_VOICE_CONFIRM" ? "Waiting for your confirmation" : waiting ? "Waiting for a clear view" : session ? "Watching automatically" : "Camera ready";
  const instruction = waiting ? WAIT_MESSAGE[waiting] : current?.instruction ?? "Mount your phone with the washer fluid inlet in view";

  return <div className="app-shell work-shell"><main className="screen work-screen">
    <header className="work-header"><button type="button" className="icon-button" aria-label="Back to home" onClick={onDone}><Icon name="close" size={22}/></button><div><span className="section-overline">CARMORI VISION</span><strong>Washer fluid refill</strong></div><span className="live-indicator"><span/>{demoMode ? "DEMO" : "LIVE"}</span></header>

    <div className="work-progress"><div className="work-progress-top"><span>{current && current.number > 0 ? `${current.number} / 4` : "Ready"}</span><strong>{current?.title ?? "Camera setup"}</strong></div><div className="progress-track">{[1, 2, 3, 4].map((n) => <i key={n} className={current && (done || current.number >= n) ? "filled" : ""}/>)}</div></div>

    <div className={`viewport${session ? " session-active" : ""}`} ref={viewportRef} onClick={pickRoi}>
      <video ref={videoRef} playsInline muted onLoadedMetadata={(e) => setVideoSize({ width: e.currentTarget.videoWidth, height: e.currentTarget.videoHeight })}/>
      <div className="camera-vignette"/>
      {cover && hands.length > 0 && <svg className="hand-overlay" viewBox={`0 0 ${viewportSize.width} ${viewportSize.height}`} aria-hidden="true">
        {hands.flatMap((hand, handIndex) => [
          ...HAND_CHAINS.map((chain, chainIndex) => <path key={`h${handIndex}-c${chainIndex}`} d={chain.map((index, pointIndex) => {
            const point = hand[index];
            return `${pointIndex ? "L" : "M"}${(point.x * cover.width - cover.offsetX).toFixed(1)} ${(point.y * cover.height - cover.offsetY).toFixed(1)}`;
          }).join(" ")}/>),
          ...[4, 8, 12, 16, 20].map((index) => <circle key={`h${handIndex}-p${index}`} cx={hand[index].x * cover.width - cover.offsetX} cy={hand[index].y * cover.height - cover.offsetY} r="3.4"/>),
        ])}
      </svg>}
      {anchor && cameraAvailable && <InletCue
        left={cover ? anchor.x * cover.width - cover.offsetX : `${anchor.x * 100}%`}
        top={cover ? anchor.y * cover.height - cover.offsetY : `${anchor.y * 100}%`}
        step={session?.step ?? null} waiting={session?.waiting_reason} paused={!!session?.paused}/>}
      <span className="camera-tag"><Icon name="camera" size={15}/>{session ? "Live view" : cameraAvailable ? "Rear camera" : "Camera unavailable"}</span>
      {cameraAvailable && handTracking !== "loading" && <span className="hand-tracking-tag">{handTracking === "unavailable" ? "Hand cues unavailable" : hands.length ? "Hands in view" : "Watching for hands"}</span>}
      {!session && <span className="camera-center-hint"><Icon name="inspect" size={31}/><strong>{roiSelected ? "Inlet area selected" : "Tap the inlet on screen"}</strong><small>Carmori will focus on this area</small></span>}
      {roiSelected && <div className="roi" style={cover ? { left: roi.x * cover.width - cover.offsetX, top: roi.y * cover.height - cover.offsetY, width: roi.w * cover.width, height: roi.h * cover.height } : { left: `${roi.x * 100}%`, top: `${roi.y * 100}%`, width: `${roi.w * 100}%`, height: `${roi.h * 100}%` }}><span>Inlet area</span></div>}
      {done && <div className="camera-complete"><span><Icon name="check" size={30}/></span><strong>Saved</strong></div>}
    </div>

    {!session && <section className="inspection-controls">
      <h2>Locate the washer inlet</h2><p>Photograph the engine bay or upload a photo. Carmori labels a cap only when the model can locate it clearly.</p>
      <div className="inspection-actions"><button type="button" onClick={capture} disabled={!cameraAvailable || analyzing}>Capture photo</button><button type="button" onClick={() => imageInputRef.current?.click()} disabled={analyzing}>Upload photo</button></div>
      <input ref={imageInputRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void upload(e.target.files?.[0], "engine")}/>
      {analyzing && <div className="inspection-message">Analyzing the photo…</div>}
      {preview && <div className="inspection-preview"><img src={preview} alt="Captured engine compartment"/>{inspection?.status === "located" && inspection.box && <div className="inspection-box" style={{ left: `${inspection.box[0] * 100}%`, top: `${inspection.box[1] * 100}%`, width: `${(inspection.box[2] - inspection.box[0]) * 100}%`, height: `${(inspection.box[3] - inspection.box[1]) * 100}%` }}><span>Washer inlet candidate</span></div>}</div>}
      {inspection && <div className={`inspection-message ${inspection.status}`}>{inspection.observation}{inspection.status === "located" && <small>AI observation · Confirm the washer symbol on the cap.</small>}</div>}
      {preview && <button type="button" className="inspection-retake" onClick={() => { setPreview(null); setInspection(null); imageInputRef.current?.click(); }}>Retake or choose another photo</button>}
      {demoMode && <p className="demo-disclosure">Demo mode simulates live step observations. It does not verify real camera actions.</p>}
      {visionStatus === "billing_required" && <div className="inspection-message uncertain">Meta Vision needs billing enabled for this API key. Photo analysis and automatic step recognition are unavailable.</div>}
    </section>}

    <section className={`observation-card${waiting ? " is-waiting" : ""}${done ? " is-done" : ""}`}>
      <div className="observation-top"><span className={`observation-dot${session && !session.paused && !done ? " pulsing" : ""}`}/><strong>{statusLabel}</strong>{session && !done && <span className="observation-auto">Hands-free progress</span>}</div>
      <h1>{instruction}</h1>
      <p>{done ? "This work is saved to your car history" : waiting ? "I will stay here until I can confirm it" : session ? "I will advance when the action is visible" : "Select the inlet area, then start the guide"}</p>
    </section>

    {lastHint && session && <div className="observed-event"><span><Icon name="eye" size={17}/></span><p>{lastHint}</p></div>}
    {error && <div className="inline-error" role="alert">{error}</div>}
    {voiceError && <div className="inline-error" role="alert">{voiceError}</div>}
    {session?.step === "CONFIRM_PRODUCT" && <section className="inspection-controls"><h2>Check the product label</h2><p>Show the label to the live camera, or upload a close-up for a separate check.</p><button type="button" onClick={() => productInputRef.current?.click()} disabled={analyzing}>Scan label photo</button><input ref={productInputRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void upload(e.target.files?.[0], "product")}/>{productInspection && <div className={`inspection-message ${productInspection.product_status.toLowerCase()}`}>{productInspection.observation} · {productInspection.product_status}</div>}</section>}
    {captions.length > 0 && <div className="work-captions"><Captions items={captions.slice(-2)}/></div>}

    {!session ? visionStatus === "billing_required" || visionStatus === "unauthorized" ? <div className="guide-blocked"><p>To continue safely, use your vehicle manual to identify the cap and verify the product label. You can save a completed refill from History.</p><button type="button" className="primary action-button work-start" onClick={onDone}>Back to my car<Icon name="arrow" size={18}/></button></div> : <button type="button" className="primary action-button work-start" onClick={() => void start()} disabled={starting}>{starting ? "Starting…" : "Start guide"}<Icon name="arrow" size={18}/></button>
      : done ? <button type="button" className="primary action-button work-start" onClick={onDone}>Back to my car<Icon name="arrow" size={18}/></button>
      : <><div className="work-footer"><div className="work-voice"><Waveform active={voiceReady && !session.paused}/><span>{voiceReady ? "Ask a question or say ‘repeat that’" : "Voice questions are unavailable. Camera guidance continues."}</span></div><button type="button" className="pause-button" onClick={() => void sendIntent(session.session_id, session.paused ? "RESUME" : "PAUSE", "touch")} aria-label={session.paused ? "Resume guide" : "Pause guide"}><Icon name={session.paused ? "play" : "pause"} size={18}/></button></div>{waiting === "NEED_VOICE_CONFIRM" && <div className="completion-confirm"><button type="button" className="primary" onClick={() => void sendIntent(session.session_id, "CONFIRM_YES", "touch")}>Yes, I completed the refill</button><button type="button" onClick={() => void sendIntent(session.session_id, "CONFIRM_NO", "touch")}>Not yet</button></div>}</>}
  </main></div>;
}
