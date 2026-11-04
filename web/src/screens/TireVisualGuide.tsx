import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "../components/Icons";
import { api, type InspectionResult, type TireViewQuality, type Vehicle } from "../lib/api";
import { cameraFailureMessage, FULL_FRAME, grabGray, grabJpeg, openRearCamera, roiAround, type Roi } from "../lib/camera";
import { captureTrackingFrame, type TrackingFrame } from "../lib/localVisualTracking";
import { photoFromFile } from "../lib/photos";
import { aimHint, averageBrightness, boxOnCoverView, trackTireBoxLocally, type Box } from "../lib/tireGuide";
import { useVoice } from "../voiceContext";

type View = "sidewall" | "tread";
type Shot = { wheel: number; view: View; photo: string; result: InspectionResult };
type Finding = InspectionResult["tire_findings"][number];

const WHEELS = [
  { label: "Driver front", short: "DF" },
  { label: "Driver rear", short: "DR" },
  { label: "Passenger rear", short: "PR" },
  { label: "Passenger front", short: "PF" },
] as const;
const STEPS = WHEELS.flatMap((_, wheel) => ([{ wheel, view: "sidewall" as const }, { wheel, view: "tread" as const }]));
const VIEW_TIP: Record<View, string> = {
  sidewall: "Stand beside the wheel and show the whole outer wall.",
  tread: "Show the grooves on the surface that touches the road.",
};
const QUALITY_LABEL: Record<TireViewQuality, string> = {
  good: "Tire found", blurry: "Hold still", dark: "Too dark", too_small: "Move closer",
  wrong_view: "Wrong side", no_tire: "No tire", unclear: "Not clear yet",
};
const TOO_DARK_BRIGHTNESS = 30;
const MOVED_DIFFERENCE = 11;

function focusRoi(box: Box | null): Roi {
  if (!box) return FULL_FRAME;
  const span = Math.max(box[2] - box[0], box[3] - box[1]);
  if (span < 0.15 || span > 0.65) return FULL_FRAME;
  return roiAround((box[0] + box[2]) / 2, (box[1] + box[3]) / 2, Math.max(0.65, Math.min(1, span * 1.4)));
}

function boxInFrame(box: Box, roi: Roi): Box {
  return [roi.x + box[0] * roi.w, roi.y + box[1] * roi.h, roi.x + box[2] * roi.w, roi.y + box[3] * roi.h];
}

function averageDifference(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return Infinity;
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

function findingLabel(finding: Finding): string {
  return finding.replaceAll("_", " ");
}

function recommendation(shots: Shot[], depths: string[]): { title: string; detail: string; tone: "warning" | "soon" | "clear" } {
  const findings = shots.flatMap((shot) => shot.result.tire_findings);
  const lowMeasuredTread = depths.some((value) => value !== "" && Number(value) <= 1.6);
  if (findings.some((item) => ["bulge", "cut", "crack", "wear_bar_level"].includes(item)) || lowMeasuredTread) {
    return { title: "Replacement check recommended", detail: "A possible damage or wear sign needs a tire professional. Do not decide tire safety from photos alone.", tone: "warning" };
  }
  if (findings.includes("uneven_wear")) {
    return { title: "Rotation and alignment check", detail: "Uneven wear is visible. Ask a tire shop to check alignment and your vehicle's rotation guidance.", tone: "soon" };
  }
  const confirmedDepths = depths.filter((value) => value !== "").length;
  return { title: "No obvious issues in these photos", detail: confirmedDepths === 4 ? "All four tread readings were confirmed. Check tire pressure separately with a gauge." : "Check the remaining tread depths and tire pressure with gauges.", tone: "clear" };
}

async function makeContactSheet(shots: Shot[], gaugePhotos: (string | null)[]): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = gaugePhotos.some(Boolean) ? 660 : 440;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Cannot build photo record");
  context.fillStyle = "#142633";
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (const shot of shots) {
    const image = new Image();
    image.src = shot.photo;
    await image.decode();
    const x = shot.wheel * 240;
    const y = shot.view === "sidewall" ? 0 : 220;
    const scale = Math.max(240 / image.width, 190 / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    context.save();
    context.beginPath();
    context.rect(x, y, 240, 190);
    context.clip();
    context.drawImage(image, x + (240 - width) / 2, y + (190 - height) / 2, width, height);
    context.restore();
    context.fillStyle = "#142633";
    context.fillRect(x, y + 190, 240, 30);
    context.fillStyle = "#fff";
    context.font = "bold 16px system-ui";
    context.fillText(`${WHEELS[shot.wheel].short} · ${shot.view}`, x + 12, y + 211);
  }
  for (let wheel = 0; wheel < gaugePhotos.length; wheel++) {
    const photo = gaugePhotos[wheel];
    if (!photo) continue;
    const image = new Image();
    image.src = photo;
    await image.decode();
    const x = wheel * 240;
    const scale = Math.max(240 / image.width, 190 / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    context.save();
    context.beginPath();
    context.rect(x, 440, 240, 190);
    context.clip();
    context.drawImage(image, x + (240 - width) / 2, 440 + (190 - height) / 2, width, height);
    context.restore();
    context.fillStyle = "#142633";
    context.fillRect(x, 630, 240, 30);
    context.fillStyle = "#fff";
    context.font = "bold 16px system-ui";
    context.fillText(`${WHEELS[wheel].short} · gauge`, x + 12, 651);
  }
  return canvas.toDataURL("image/jpeg", 0.72);
}

export function TireVisualGuide({ vehicle, onSaved, onCancel }: { vehicle: Vehicle; onSaved: () => void; onCancel: () => void }) {
  const voice = useVoice();
  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inFlightRef = useRef(false);
  const previousFrameRef = useRef<Uint8Array | null>(null);
  const acceptedFrameRef = useRef<Uint8Array | null>(null);
  const movementNeededRef = useRef(false);
  const stableCountRef = useRef(0);
  const lastAttemptRef = useRef(-Infinity);
  const activeIndexRef = useRef(0);
  const gaugeWheelRef = useRef<number | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);
  const bestFrameRef = useRef<{ score: number; jpeg: string; gray: Uint8Array; roi: Roi } | null>(null);
  const [captureNotice, setCaptureNotice] = useState("");
  const [retryRequired, setRetryRequired] = useState(false);
  const [selectedWheel, setSelectedWheel] = useState<number | null>(null);
  const [swapWheel, setSwapWheel] = useState<number | null>(null);
  const trackedOutlineRef = useRef<{ frame: TrackingFrame; box: Box; label: string; index: number } | null>(null);
  const [outline, setOutline] = useState<{ box: Box; label: string } | null>(null);
  const [viewSize, setViewSize] = useState({ width: 0, height: 0 });
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraFailure, setCameraFailure] = useState<string | null>(null);
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const [scanIndex, setScanIndex] = useState(0);
  const [shots, setShots] = useState<Shot[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Starting camera…");
  const [error, setError] = useState<string | null>(null);
  const [depths, setDepths] = useState(["", "", "", ""]);
  const [gaugePhotos, setGaugePhotos] = useState<(string | null)[]>([null, null, null, null]);
  const [gaugeWheel, setGaugeWheel] = useState<number | null>(null);
  const [gaugeSuggestion, setGaugeSuggestion] = useState<{ mm: string; label: string; photo: string } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const initialStepRef = useRef(true);
  const spokenKeysRef = useRef(new Set<string>());

  activeIndexRef.current = scanIndex;
  gaugeWheelRef.current = gaugeWheel;
  const complete = scanIndex === STEPS.length;
  const current = STEPS[Math.min(scanIndex, STEPS.length - 1)];
  const result = complete ? recommendation(shots, depths) : null;
  const stepInstruction = gaugeWheel !== null
    ? `Show the tread-depth gauge reading and unit for the ${WHEELS[gaugeWheel].label.toLowerCase()} tire.`
    : complete
      ? `${result?.title ?? "Tire check complete"}. Review the photos and tire positions before saving.`
      : `${WHEELS[current.wheel].label} tire. ${VIEW_TIP[current.view]}`;
  const announce = (key: string, text: string) => {
    if (spokenKeysRef.current.has(key)) return;
    spokenKeysRef.current.add(key);
    void voice.speak(text);
  };

  useEffect(() => {
    spokenKeysRef.current.clear();
    if (initialStepRef.current) { initialStepRef.current = false; return; }
    if (scanIndex === STEPS.length) {
      announce("complete", stepInstruction);
      return;
    }
    const step = STEPS[scanIndex];
    const lead = step.view === "tread" ? "Sidewall captured. " : scanIndex > 0 ? `${WHEELS[step.wheel].label} tire next. ` : "";
    announce(`step:${scanIndex}`, `${lead}${VIEW_TIP[step.view]}`);
  }, [scanIndex]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    setCameraReady(false);
    setCameraFailure(null);
    const timer = window.setTimeout(() => {
      void openRearCamera(video, { width: 1920, height: 1080 })
        .then((opened) => {
          if (stopped) {
            opened.getTracks().forEach((track) => track.stop());
            if (video.srcObject === opened) video.srcObject = null;
          } else {
            stream = opened;
            setCameraReady(true);
            setStatus(VIEW_TIP.sidewall);
          }
        })
        .catch((cause) => { if (!stopped) setCameraFailure(cameraFailureMessage(cause)); });
    }, 0);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
      if (video.srcObject === stream) video.srcObject = null;
    };
  }, [cameraAttempt]);

  useEffect(() => {
    requestRef.current += 1;
    lastAttemptRef.current = -Infinity;
    bestFrameRef.current = null;
    previousFrameRef.current = null;
    stableCountRef.current = 0;
    movementNeededRef.current = scanIndex > 0 && acceptedFrameRef.current !== null;
    trackedOutlineRef.current = null;
    setOutline(null);
    if (scanIndex < STEPS.length) {
      const step = STEPS[scanIndex];
      setStatus(step.view === "sidewall" && scanIndex > 0 ? `Walk to the ${WHEELS[step.wheel].label.toLowerCase()} wheel. ${VIEW_TIP.sidewall}` : VIEW_TIP[step.view]);
    }
  }, [scanIndex]);

  useEffect(() => {
    if (!captureNotice) return;
    const timer = window.setTimeout(() => setCaptureNotice(""), 2400);
    return () => window.clearTimeout(timer);
  }, [captureNotice]);

  useEffect(() => () => { requestRef.current += 1; }, []);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const analyzePhoto = async (jpeg: string, frame: Uint8Array | null, roi: Roi = FULL_FRAME) => {
    if (inFlightRef.current || complete) return;
    const index = scanIndex;
    const step = STEPS[index];
    const request = ++requestRef.current;
    inFlightRef.current = true;
    lastAttemptRef.current = performance.now();
    setBusy(true);
    setError(null);
    setStatus(`Checking ${WHEELS[step.wheel].label.toLowerCase()} ${step.view}…`);
    try {
      const response = await api.analyzeInspection(vehicle.vehicle_id, {
        component: "tires", photo_type: step.view === "sidewall" ? "tire_sidewall" : "tire_tread", jpeg_base64: jpeg,
      });
      if (activeIndexRef.current !== index || requestRef.current !== request) return;
      if (response.status === "located" && response.tire_view_valid && response.source === "meta_vision") {
        acceptedFrameRef.current = frame;
        const photo = `data:image/jpeg;base64,${jpeg}`;
        setShots((previous) => [...previous.filter((shot) => shot.wheel !== step.wheel || shot.view !== step.view), { wheel: step.wheel, view: step.view, photo, result: response }]);
        setCaptureNotice(step.view === "sidewall" ? "Sidewall captured ✓" : `${WHEELS[step.wheel].label} complete ✓`);
        if (step.view === "tread") {
          try { navigator.vibrate?.(80); } catch { /* Vibration is optional. */ }
        }
        setRetryRequired(false);
        const updatedShots = [...shots.filter((shot) => shot.wheel !== step.wheel || shot.view !== step.view), { wheel: step.wheel, view: step.view, photo, result: response }];
        const sameWheelNext = STEPS.findIndex((candidate) => candidate.wheel === step.wheel && !updatedShots.some((shot) => shot.wheel === candidate.wheel && shot.view === candidate.view));
        const next = sameWheelNext >= 0 ? sameWheelNext : STEPS.findIndex((candidate) => !updatedShots.some((shot) => shot.wheel === candidate.wheel && shot.view === candidate.view));
        setScanIndex(next < 0 ? STEPS.length : next);
      } else {
        acceptedFrameRef.current = frame;
        movementNeededRef.current = frame !== null;
        const box = response.tire_box ? boxInFrame(response.tire_box as Box, roi) : null;
        const hint = box ? aimHint(box) : null;
        setStatus(hint && response.rejection_reason !== "too_small" ? `${response.observation} ${hint}.` : response.observation);
        const retrySpeech: Partial<Record<TireViewQuality, string>> = {
          blurry: "Hold the camera still for a clearer tire photo.",
          dark: "Add light to the tire or change the angle.",
          too_small: "Move closer to the tire.",
          wrong_view: step.view === "tread" ? "Tilt the camera toward the tread grooves." : "Show the tire's outer sidewall.",
          no_tire: "Bring the tire into the camera view.",
          unclear: "I cannot confirm this tire view yet. Move the phone for a clearer view.",
        };
        const retryLine = response.rejection_reason ? retrySpeech[response.rejection_reason] : retrySpeech.unclear;
        if (retryLine) announce(`retry:${index}:${response.rejection_reason ?? "unclear"}`, retryLine);
        // The box belongs to this frame, so it is only drawn for live shots and until the phone moves.
        let stillCurrent = false;
        if (box && frame && videoRef.current?.videoWidth) {
          try { stillCurrent = averageDifference(frame, grabGray(videoRef.current, FULL_FRAME, 48)) <= MOVED_DIFFERENCE; } catch { /* Camera closed. */ }
        }
        const label = hint && response.rejection_reason !== "too_small" ? hint : QUALITY_LABEL[response.rejection_reason ?? "unclear"];
        const visible = box && frame && stillCurrent && videoRef.current ? { box, label } : null;
        try {
          trackedOutlineRef.current = visible && videoRef.current ? { ...visible, frame: captureTrackingFrame(videoRef.current), index } : null;
        } catch { trackedOutlineRef.current = null; }
        setOutline(trackedOutlineRef.current ? visible : null);
      }
    } catch {
      if (activeIndexRef.current === index && requestRef.current === request) {
        setRetryRequired(true);
        trackedOutlineRef.current = null;
        setOutline(null);
        setError("Analysis paused. Your photos are kept; try this view again.");
        setStatus("Check paused");
        announce(`error:${index}`, "Analysis paused. Your photos are saved. Retry this view when connected.");
      }
    } finally {
      inFlightRef.current = false;
      setBusy(false);
      stableCountRef.current = 0;
      previousFrameRef.current = null;
    }
  };

  const captureNow = () => {
    const video = videoRef.current;
    if (!cameraReady || !video?.videoWidth || inFlightRef.current || retryRequired) return;
    try {
      const frame = grabGray(video, FULL_FRAME, 48);
      if (averageBrightness(frame) < TOO_DARK_BRIGHTNESS) { setStatus("It's too dark here. Add light or change the angle."); return; }
      const roi = focusRoi(trackedOutlineRef.current?.index === scanIndex ? trackedOutlineRef.current.box : null);
      void analyzePhoto(grabJpeg(video, roi, 1600, 0.82), frame, roi);
    } catch { setError("The camera frame could not be captured. Try again."); }
  };

  useEffect(() => {
    if (!cameraReady || complete) return;
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video?.videoWidth || inFlightRef.current || busy || retryRequired || activeIndexRef.current !== scanIndex) return;
      let frame: Uint8Array;
      try { frame = grabGray(video, FULL_FRAME, 48); }
      catch { return; }
      if (movementNeededRef.current && acceptedFrameRef.current && averageDifference(frame, acceptedFrameRef.current) > MOVED_DIFFERENCE) {
        movementNeededRef.current = false;
      }
      const previous = previousFrameRef.current;
      previousFrameRef.current = frame;
      if (!previous) return;
      stableCountRef.current = averageDifference(frame, previous) < 4 ? stableCountRef.current + 1 : 0;
      if (!stableCountRef.current) bestFrameRef.current = null;
      if (stableCountRef.current && !movementNeededRef.current && averageBrightness(frame) >= TOO_DARK_BRIGHTNESS) {
        let score = 0;
        for (let i = 1; i < frame.length; i++) score += Math.abs(frame[i] - frame[i - 1]);
        if (!bestFrameRef.current || score > bestFrameRef.current.score) {
          try {
            const roi = focusRoi(trackedOutlineRef.current?.index === scanIndex ? trackedOutlineRef.current.box : null);
            bestFrameRef.current = { score, jpeg: grabJpeg(video, roi, 1600, 0.82), gray: frame, roi };
          } catch { /* Wait for the next frame. */ }
        }
      }
      // Local checks run first, so a dark or moving view does not use a model call.
      if (averageBrightness(frame) < TOO_DARK_BRIGHTNESS) { stableCountRef.current = 0; setStatus("It's too dark here. Add light or change the angle."); announce(`dark:${scanIndex}`, "Add light to the tire or change the angle."); return; }
      if (!movementNeededRef.current && stableCountRef.current === 0) setStatus("Hold still…");
      if (movementNeededRef.current || stableCountRef.current < 3 || performance.now() - lastAttemptRef.current < 5000) return;
      const best = bestFrameRef.current;
      bestFrameRef.current = null;
      if (best) void analyzePhoto(best.jpeg, best.gray, best.roi);
    }, 400);
    return () => window.clearInterval(timer);
  }, [cameraReady, complete, scanIndex, busy, retryRequired]);

  useEffect(() => {
    if (!cameraReady || complete || gaugeWheel !== null || retryRequired) return;
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      const target = trackedOutlineRef.current;
      if (!video?.videoWidth || !target || target.index !== scanIndex || document.hidden) return;
      try {
        const frame = captureTrackingFrame(video);
        const box = trackTireBoxLocally(target.frame, frame, target.box);
        if (!box) { trackedOutlineRef.current = null; setOutline(null); return; }
        const label = aimHint(box) ?? (target.label.startsWith("Aim the phone") ? "Tire found" : target.label);
        trackedOutlineRef.current = { frame, box, label, index: scanIndex };
        setOutline({ box, label });
      } catch { trackedOutlineRef.current = null; setOutline(null); }
    }, 180);
    return () => window.clearInterval(timer);
  }, [cameraReady, complete, scanIndex, gaugeWheel, retryRequired]);

  useEffect(() => {
    if (gaugeWheel === null) return;
    previousFrameRef.current = null;
    acceptedFrameRef.current = null;
    movementNeededRef.current = false;
    stableCountRef.current = 0;
    setStatus("Show the tread-depth gauge reading and unit. Hold still for automatic capture.");
  }, [gaugeWheel]);

  const readGaugePhoto = async (jpeg: string, frame: Uint8Array | null) => {
    if (gaugeWheel === null || inFlightRef.current) return;
    const wheel = gaugeWheel;
    inFlightRef.current = true;
    lastAttemptRef.current = performance.now();
    setBusy(true);
    setError(null);
    setStatus("Reading the gauge…");
    try {
      const response = await api.analyzeInspection(vehicle.vehicle_id, { component: "tires", photo_type: "tire_tread_gauge", jpeg_base64: jpeg });
      if (gaugeWheelRef.current !== wheel) return;
      if (response.status === "located" && response.gauge_value !== null && response.gauge_unit && response.source === "meta_vision") {
        const mm = response.gauge_unit === "mm" ? response.gauge_value : response.gauge_value * 25.4 / 32;
        setGaugeSuggestion({ mm: mm.toFixed(1), label: `${response.gauge_value} ${response.gauge_unit === "mm" ? "mm" : "⁄32 in"}`, photo: `data:image/jpeg;base64,${jpeg}` });
        setStatus("Confirm the reading before it is used.");
      } else {
        acceptedFrameRef.current = frame;
        movementNeededRef.current = frame !== null;
        setStatus(response.observation);
      }
    } catch {
      if (gaugeWheelRef.current === wheel) setError("Gauge reading is unavailable. Try again or enter the value yourself.");
    } finally {
      inFlightRef.current = false;
      setBusy(false);
      stableCountRef.current = 0;
      previousFrameRef.current = null;
    }
  };

  const captureGaugeNow = () => {
    const video = videoRef.current;
    if (gaugeWheel === null || !cameraReady || !video?.videoWidth || inFlightRef.current || gaugeSuggestion) return;
    try {
      const frame = grabGray(video, FULL_FRAME, 48);
      if (Math.max(...frame) < 12) { setStatus("The camera view is too dark. Add light and try again."); return; }
      void readGaugePhoto(grabJpeg(video, FULL_FRAME, 1600, 0.84), frame);
    } catch { setError("The gauge frame could not be captured. Try again."); }
  };

  useEffect(() => {
    if (!cameraReady || gaugeWheel === null || gaugeSuggestion) return;
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video?.videoWidth || inFlightRef.current || busy || gaugeWheelRef.current !== gaugeWheel) return;
      let frame: Uint8Array;
      try { frame = grabGray(video, FULL_FRAME, 48); }
      catch { return; }
      if (movementNeededRef.current && acceptedFrameRef.current && averageDifference(frame, acceptedFrameRef.current) > 11) movementNeededRef.current = false;
      const previous = previousFrameRef.current;
      previousFrameRef.current = frame;
      if (!previous) return;
      stableCountRef.current = averageDifference(frame, previous) < 4 ? stableCountRef.current + 1 : 0;
      if (!movementNeededRef.current && stableCountRef.current >= 3 && performance.now() - lastAttemptRef.current >= 5000) captureGaugeNow();
    }, 400);
    return () => window.clearInterval(timer);
  }, [cameraReady, gaugeWheel, gaugeSuggestion, busy]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const jpeg = await photoFromFile(file);
      if (gaugeWheel !== null) await readGaugePhoto(jpeg, null);
      else await analyzePhoto(jpeg, null);
    }
    catch { setError("Could not read the photo. Try another image."); }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!confirmed || shots.length !== STEPS.length || !result) return;
    setBusy(true);
    setError(null);
    const details = [result.title, ...WHEELS.map((wheel, index) => {
      const findings = shots.filter((shot) => shot.wheel === index).flatMap((shot) => shot.result.tire_findings);
      return `${wheel.label}: ${findings.length ? findings.map(findingLabel).join(", ") : "no obvious issue in photos"}${depths[index] ? `; confirmed tread gauge ${depths[index]} mm${gaugePhotos[index] ? " (camera read)" : " (entered by user)"}` : "; tread depth not measured"}`;
    }), "Tire photos alone do not measure pressure or tread depth."].join(". ");
    try {
      const contactSheet = await makeContactSheet(shots, gaugePhotos);
      await api.addRecord({ vehicle_id: vehicle.vehicle_id, component: "tires", event_type: "inspection", completed_at: new Date().toISOString(), odometer_km: vehicle.odometer_km ?? undefined, notes: details, photo_data_url: contactSheet, user_confirmed: true });
      onSaved();
    } catch { setError("Could not save the tire check. Try again."); }
    finally { setBusy(false); }
  };

  const video = videoRef.current;
  const outlineStyle = outline && video?.videoWidth && viewSize.width
    ? boxOnCoverView(outline.box, { width: video.videoWidth, height: video.videoHeight }, viewSize) : null;

  return <div className="arw arw-overlay tire-guide" role="dialog" aria-modal="true" aria-label="Four tire visual check">
    <div className="arw-viewport" ref={viewportRef}>
      <video ref={videoRef} playsInline muted/>
      {cameraReady && gaugeWheel !== null ? <div className="tire-camera-target gauge" aria-hidden="true"><span>Show gauge digits and unit</span></div>
        : !complete && cameraReady && (outlineStyle
          ? <div className="tire-outline" style={outlineStyle} aria-hidden="true"><span>{outline?.label}</span></div>
          : <span className="tire-looking" aria-hidden="true">{busy ? "Checking this view…" : `Looking for the ${current.view === "sidewall" ? "sidewall" : "tread"}`}</span>)}
      {cameraFailure && <p className="arw-no-camera" role="alert">{cameraFailure}</p>}
    </div>
    {captureNotice && <div className="tire-capture-notice" role="status">{captureNotice}</div>}
    <header className="arw-top">
      <button type="button" className="arw-icon" aria-label="Close tire guide" onClick={onCancel}><Icon name="close" size={22}/></button>
      <div className="arw-progress"><strong>{gaugeWheel !== null ? `Read gauge · ${WHEELS[gaugeWheel].label}` : complete ? "Tire check complete" : `${shots.length + 1}/8 · ${WHEELS[current.wheel].label} · ${current.view}`}</strong><div className="arw-progress-track">{STEPS.map((_, index) => <i key={index} className={shots.some((shot) => shot.wheel === STEPS[index].wheel && shot.view === STEPS[index].view) ? "filled" : ""}/>)}</div></div>
      {cameraReady && (!complete || gaugeWheel !== null) && <span className="arw-live"><span/>LIVE</span>}
    </header>
    {!complete && <div className="tire-route" aria-label="Tire check order">
      <span className="tire-route-car">FRONT<br/>CAR<br/>REAR</span>
      {WHEELS.map((wheel, index) => <button type="button" key={wheel.short} disabled={busy || shots.filter((shot) => shot.wheel === index).length === 2} onClick={() => { const next = STEPS.findIndex((step) => step.wheel === index && !shots.some((shot) => shot.wheel === index && shot.view === step.view)); if (next < 0) return; requestRef.current += 1; setRetryRequired(false); setError(null); setScanIndex(next); }} className={`tire-route-wheel wheel-${index}${index === current.wheel ? " active" : ""}${shots.filter((shot) => shot.wheel === index).length === 2 ? " checked" : ""}`} aria-label={`Check ${wheel.label}`}>{index === current.wheel ? "➜" : shots.filter((shot) => shot.wheel === index).length === 2 ? "✓" : "·"}<small>{wheel.short}</small></button>)}
    </div>}
    <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ""; }}/>
    <div className="arw-bottom">
      {error && <div className="arw-error" role="alert">{error}</div>}
      {!complete ? <section className="arw-card tire-guide-card" aria-live="polite">
        <div className="arw-card-top"><span className="arw-status"><span className="arw-dot"/>{busy ? "Analyzing camera view" : retryRequired ? "Analysis paused" : cameraFailure ? "Camera unavailable" : "Auto capture on"}</span><button type="button" className="arw-hear" onClick={() => void voice.speak(stepInstruction)} aria-label="Hear current tire instruction"><Icon name="volume" size={20}/></button></div>
        <h1>{WHEELS[current.wheel].label}: show the {current.view}</h1>
        <p>{retryRequired ? "Analysis paused. Retry when connected." : status}</p>
        {current.view === "tread" && shots.find((shot) => shot.wheel === current.wheel && shot.view === "sidewall") && <div className="tire-last-shot"><img src={shots.find((shot) => shot.wheel === current.wheel && shot.view === "sidewall")?.photo} alt="Captured sidewall"/><span>Sidewall captured ✓<br/>Now show the tread grooves.</span></div>}
        <div className="arw-actions">
          <button type="button" className="arw-secondary" onClick={() => inputRef.current?.click()} disabled={busy}><Icon name="file" size={18}/>Upload view</button>
          {retryRequired ? <button type="button" className="arw-primary" onClick={() => { setRetryRequired(false); setError(null); lastAttemptRef.current = -Infinity; movementNeededRef.current = false; setStatus(VIEW_TIP[current.view]); }}>Retry analysis</button> : cameraFailure ? <button type="button" className="arw-primary" onClick={() => setCameraAttempt((attempt) => attempt + 1)}><Icon name="camera" size={18}/>Try camera again</button>
            : <button type="button" className="arw-primary" onClick={captureNow} disabled={!cameraReady || busy}><Icon name="camera" size={18}/>{busy ? "Checking…" : "Scan now"}</button>}
        </div>
      </section> : gaugeWheel !== null ? <section className="arw-card tire-guide-card" aria-live="polite">
        <div className="arw-card-top"><span className="arw-status"><span className="arw-dot"/>{busy ? "Reading camera view" : "Tread-depth gauge"}</span><button type="button" className="arw-hear" onClick={() => void voice.speak(stepInstruction)} aria-label="Hear gauge instruction"><Icon name="volume" size={20}/></button></div>
        <h1>{WHEELS[gaugeWheel].label}: show the gauge</h1>
        {gaugeSuggestion ? <><p>Camera read <strong>{gaugeSuggestion.label}</strong> ({gaugeSuggestion.mm} mm). Check the display yourself before using it.</p><img className="tire-gauge-preview" src={gaugeSuggestion.photo} alt="Gauge photo to confirm"/>
          <div className="arw-actions"><button type="button" className="arw-secondary" onClick={() => { setGaugeSuggestion(null); setStatus("Show the gauge again."); }}>Try again</button><button type="button" className="arw-primary" onClick={() => { setDepths((values) => values.map((value, index) => index === gaugeWheel ? gaugeSuggestion.mm : value)); setGaugePhotos((values) => values.map((value, index) => index === gaugeWheel ? gaugeSuggestion.photo : value)); setGaugeSuggestion(null); setGaugeWheel(null); }}>Use reading</button></div>
        </> : <><p>{status}</p><div className="arw-actions"><button type="button" className="arw-secondary" onClick={() => inputRef.current?.click()} disabled={busy}><Icon name="file" size={18}/>Upload photo</button><button type="button" className="arw-primary" onClick={captureGaugeNow} disabled={!cameraReady || busy}><Icon name="camera" size={18}/>{busy ? "Reading…" : "Read now"}</button></div></>}
        <button type="button" className="arw-link" onClick={() => { setGaugeWheel(null); setGaugeSuggestion(null); setError(null); }}>Back to results</button>
      </section> : <form className="arw-card tire-guide-summary" onSubmit={(event) => void save(event)}>
        <div className="arw-card-top"><span className={`tire-result-tone ${result?.tone}`}>Four tires · Eight camera views</span><button type="button" className="arw-hear" onClick={() => void voice.speak(stepInstruction)} aria-label="Hear tire check result"><Icon name="volume" size={20}/></button></div>
        <h1>{result?.title}</h1><p>{result?.detail}</p>
        <div className="tire-summary-map" aria-label="Select a tire to see its results">{WHEELS.map((wheel, index) => {
          const wheelShots = shots.filter((shot) => shot.wheel === index);
          const findings = wheelShots.flatMap((shot) => shot.result.tire_findings);
          const tone = wheelShots.length < 2 ? "unknown" : findings.some((item) => ["bulge", "cut", "crack", "wear_bar_level"].includes(item)) || (depths[index] !== "" && Number(depths[index]) <= 1.6) ? "warning" : findings.length ? "soon" : depths[index] ? "clear" : "unknown";
          return <button key={wheel.short} type="button" className={`tire-map-wheel wheel-${index} ${tone}`} aria-pressed={selectedWheel === index} onClick={() => setSelectedWheel(index)}>{wheel.label}</button>;
        })}</div>
        <p>Tap a tire for its photos and readings.</p>
        <div className="tire-wheel-results">{WHEELS.map((wheel, index) => {
          const wheelShots = shots.filter((shot) => shot.wheel === index);
          return <div className="tire-wheel-result" key={wheel.short} hidden={selectedWheel !== index}><strong>{wheel.label}</strong>{wheelShots.map((shot) => <span key={shot.view}>{shot.view === "sidewall" ? "Sidewall" : "Tread"}: {shot.result.tire_findings.length ? shot.result.tire_findings.map(findingLabel).join(", ") : "no visible issue"}</span>)}<span className={depths[index] ? "tire-measured" : "tire-not-measured"}>Tread depth: {depths[index] ? `${depths[index]} mm${gaugePhotos[index] ? " (gauge photo, confirmed)" : " (entered)"}` : "not measured"}</span><span className="tire-not-measured">Pressure: not measured</span><div>{wheelShots.map((shot) => <img key={shot.view} src={shot.photo} alt={`${wheel.label} ${shot.view}`}/>)}</div>{wheelShots.map((shot) => <button type="button" className="tire-gauge-action" key={`retake-${shot.view}`} onClick={() => { setShots((items) => items.filter((item) => item.wheel !== index || item.view !== shot.view)); setConfirmed(false); setRetryRequired(false); setError(null); setScanIndex(STEPS.findIndex((step) => step.wheel === index && step.view === shot.view)); }}>Retake {shot.view}</button>)}<button type="button" className="tire-gauge-action" onClick={() => { void voice.speak(`Show the tread-depth gauge reading and unit for the ${wheel.label.toLowerCase()} tire.`); setGaugeWheel(index); setGaugeSuggestion(null); setError(null); }}>Read gauge with camera</button><label>Confirmed tread (mm)<input type="number" min="0" max="30" step="0.1" inputMode="decimal" value={depths[index]} onChange={(event) => { setDepths((values) => values.map((value, i) => i === index ? event.target.value : value)); setGaugePhotos((values) => values.map((value, i) => i === index ? null : value)); }} placeholder="Optional"/></label></div>;
        })}</div>
        <label className="tire-swap-label">Correct tire positions<select value={swapWheel ?? ""} onChange={(event) => setSwapWheel(event.target.value === "" ? null : Number(event.target.value))}><option value="">Choose a tire to swap</option>{WHEELS.map((wheel, index) => <option key={wheel.short} value={index}>{wheel.label}</option>)}</select></label>
        {swapWheel !== null && <div className="tire-swap-actions">{WHEELS.map((wheel, index) => index !== swapWheel && <button type="button" key={wheel.short} onClick={() => { const other = swapWheel; setShots((items) => items.map((shot) => ({ ...shot, wheel: shot.wheel === other ? index : shot.wheel === index ? other : shot.wheel }))); setDepths((values) => values.map((value, i) => i === other ? values[index] : i === index ? values[other] : value)); setGaugePhotos((values) => values.map((value, i) => i === other ? values[index] : i === index ? values[other] : value)); setSwapWheel(null); setConfirmed(false); }}>Swap with {wheel.label}</button>)}</div>}
        <p className="tire-measure-note">A visible gauge reading can be read from the camera after you confirm it. Tire photos alone cannot measure depth or pressure. Wheel positions follow the order you checked.</p>
        <label className="record-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}/><span>I checked these four tire positions.</span></label>
        <button type="submit" className="arw-primary" disabled={!confirmed || busy}>{busy ? "Saving…" : "Save tire check"}</button>
      </form>}
    </div>
  </div>;
}
