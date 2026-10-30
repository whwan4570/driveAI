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
  // Where the inlet is in the camera frame (0–1): the tapped point, or the box found in a live capture.
  const [inletPoint, setInletPoint] = useState<{ x: number; y: number } | null>(null);
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [session, setSession] = useState<SessionView | null>(null);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [cameraAvailable, setCameraAvailable] = useState(true);
  const [demoMode, setDemoMode] = useState(false);
  const [visionStatus, setVisionStatus] = useState<string>("unverified");
  const [inspection, setInspection] = useState<InspectionResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [productInspection, setProductInspection] = useState<InspectionResult | null>(null);
  const productInputRef = useRef<HTMLInputElement>(null);
  const [starting, setStarting] = useState(false);
  const [hands, setHands] = useState<HandPoint[][]>([]);
  const [handTracking, setHandTracking] = useState<"loading" | "ready" | "unavailable">("loading");
  const add = (who: Caption["who"], text: string) => setCaptions((c) => [...c, { who, text }]);

  const say = async (text: string | null) => {
    if (!text) return;
    add("carmori", text);
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
        .catch(() => { if (!cancelled) setCameraAvailable(false); });
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
    if (photoType === "engine") setInspection(null);
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
    void analyzePhoto(grabJpeg(videoRef.current, FULL_FRAME, 1600, 0.78), "engine");
  };

  const upload = async (file: File | undefined, photoType: "engine" | "product") => {
    if (!file) return;
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

  const located = inspection?.status === "located" && inspection.box
    ? { x: (inspection.box[0] + inspection.box[2]) / 2, y: (inspection.box[1] + inspection.box[3]) / 2 } : null;
  const anchor = roiSelected && inletPoint ? inletPoint : located;

  const current = session ? STEPS[session.step] : null;
  const done = session?.step === "RECORDED";
  const waiting = session?.waiting_reason;
  const statusLabel = done ? "Task complete" : session?.paused ? "Paused" : waiting === "NEED_VOICE_CONFIRM" ? "Waiting for your confirmation" : waiting ? "Waiting for a clear view" : session ? "Watching automatically" : "Camera ready";
  const instruction = waiting ? WAIT_MESSAGE[waiting] : current?.instruction ?? "Mount your phone with the washer fluid inlet in view";

  const visionBlocked = visionStatus === "billing_required" || visionStatus === "unauthorized";
  const roiStyle = cover ? { left: roi.x * cover.width - cover.offsetX, top: roi.y * cover.height - cover.offsetY, width: roi.w * cover.width, height: roi.h * cover.height }
    : { left: `${roi.x * 100}%`, top: `${roi.y * 100}%`, width: `${roi.w * 100}%`, height: `${roi.h * 100}%` };

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
      {roiSelected && !done && <div className="arw-roi" style={roiStyle}/>}
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
      <span className="arw-live"><span/>{demoMode ? "DEMO" : "LIVE"}</span>
    </header>
    {cameraAvailable && handTracking === "ready" && hands.length > 0 && <span className="arw-hands">Hands in view</span>}

    <div className="arw-bottom">
      {captions.length > 0 && session && <div className="arw-captions"><Captions items={captions.slice(-2)}/></div>}
      {error && <div className="arw-error" role="alert">{error}</div>}
      {voiceError && <div className="arw-error" role="alert">{voiceError}</div>}

      <section className={`arw-card${waiting ? " is-waiting" : ""}${done ? " is-done" : ""}`} aria-live="polite">
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
          <h1>{anchor ? "Keep the phone still and start" : "Tap the washer cap on screen"}</h1>
          <p>{anchor ? "Tap again to move the marker." : "Mount your phone so the cap stays in view."}</p>
          {analyzing && <p className="arw-note">Looking for the inlet…</p>}
          {inspection && !analyzing && <p className={`arw-note ${inspection.status}`}>{inspection.observation}</p>}
          <div className="arw-actions">
            <button type="button" className="arw-secondary" onClick={capture} disabled={analyzing}><Icon name="camera" size={18}/>Find it for me</button>
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
            <button type="button" className="arw-pause" onClick={() => void sendIntent(session.session_id, session.paused ? "RESUME" : "PAUSE", "touch")} aria-label={session.paused ? "Resume guide" : "Pause guide"}><Icon name={session.paused ? "play" : "pause"} size={18}/></button>
          </div>
          <h1>{instruction}</h1>
          {waiting === "NEED_VOICE_CONFIRM" ? <div className="arw-actions">
            <button type="button" className="arw-secondary" onClick={() => void sendIntent(session.session_id, "CONFIRM_NO", "touch")}>Not yet</button>
            <button type="button" className="arw-primary" onClick={() => void sendIntent(session.session_id, "CONFIRM_YES", "touch")}>Yes, refilled</button>
          </div> : session.step === "CONFIRM_PRODUCT" ? <>
            <button type="button" className="arw-secondary is-wide" onClick={() => productInputRef.current?.click()} disabled={analyzing}><Icon name="camera" size={18}/>Scan label photo</button>
            <input ref={productInputRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void upload(e.target.files?.[0], "product")}/>
            {productInspection && <p className={`arw-note ${productInspection.product_status.toLowerCase()}`}>{productInspection.observation} · {productInspection.product_status}</p>}
          </> : <div className="arw-voice"><Waveform active={voiceReady && !session.paused}/><span>{voiceReady ? "Say ‘repeat that’ or ask a question" : "Voice is off. The camera keeps guiding."}</span></div>}
        </>}
      </section>
    </div>
  </main></div>;
}
