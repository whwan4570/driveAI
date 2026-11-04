import type { Roi } from "./camera";
import { captureTrackingFrame, trackVerifiedInlet, type TrackingFrame, type TrackingPoint } from "./localVisualTracking";
import type { InspectionResult } from "./api";

export type SearchFrame = { time: number; tracking: TrackingFrame };

// Motion can delay automatic searching, but must never prevent it forever.
export function shouldSearch({ manual, stable, elapsed }: { manual: boolean; stable: number; elapsed: number }): boolean {
  return manual || (elapsed >= 2000 && (stable >= 3 || elapsed >= 4000));
}

export function followSearchPoint(frames: SearchFrame[], from: number, to: number, point: TrackingPoint): TrackingPoint | null {
  const start = frames.findIndex((frame) => frame.time === from);
  if (start < 0 || !frames.some((frame) => frame.time === to) || to < from) return null;
  let current = point;
  for (let i = start + 1; i < frames.length && frames[i].time <= to; i++) {
    if (frames[i].time - frames[i - 1].time > 450) return null;
    const next = trackVerifiedInlet(frames[i - 1].tracking, frames[i].tracking, current);
    if (!next) return null;
    current = next;
  }
  return current;
}

export function visibleSearchRoi(requested: Roi, visible: Roi): Roi | null {
  const x = Math.max(requested.x, visible.x, 0), y = Math.max(requested.y, visible.y, 0);
  const right = Math.min(requested.x + requested.w, visible.x + visible.w, 1);
  const bottom = Math.min(requested.y + requested.h, visible.y + visible.h, 1);
  return right > x && bottom > y ? { x, y, w: right - x, h: bottom - y } : null;
}

type LocateResult = { kind: "located"; point: TrackingPoint; tracking: TrackingFrame; inspection: InspectionResult }
  | { kind: "wait"; message: string }
  | { kind: "unavailable"; message: string; inspection: InspectionResult };

// Shared by initial search and lost-marker recovery. Only verified, current coordinates escape.
export async function locateVerifiedInlet(video: HTMLVideoElement, roi: Roi,
  inspect: (jpeg: string) => Promise<InspectionResult>, active: () => boolean,
  visible: () => Roi, diagnostic?: (results: InspectionResult[]) => void): Promise<LocateResult> {
  const trail: SearchFrame[] = [];
  const sample = () => {
    const frame = { time: performance.now(), tracking: captureTrackingFrame(video) };
    trail.push(frame);
    while (trail.length > 180) trail.shift();
    return frame;
  };
  const timer = window.setInterval(() => { if (active() && video.readyState >= 2) { try { sample(); } catch { /* A missing frame invalidates the trail. */ } } }, 100);
  try {
    const first = snapshotVideo(video), firstTrack = sample(), time = video.currentTime;
    await new Promise<void>(resolve => window.setTimeout(resolve, 500));
    if (!active() || video.currentTime <= time) return { kind: "wait", message: "Waiting for a new camera frame." };
    const second = snapshotVideo(video), secondTrack = sample();
    const results = await Promise.all([first, second].map(capture => inspect(encodeSearchCrop(capture, roi))));
    if (!active()) return { kind: "wait", message: "Search cancelled." };
    diagnostic?.(results);
    const unavailable = results.find(result => result.status === "unavailable");
    if (unavailable) return { kind: "unavailable", message: unavailable.observation, inspection: unavailable };
    const boxes = results.map(result => result.status === "located" && result.box ? result.box : null);
    const [a, b] = boxes;
    if (!a || !b) return { kind: "wait", message: "I could not verify the cap in both views. Hold closer and try again." };
    const center = (box: number[]) => ({ x: roi.x + (box[0] + box[2]) / 2 * roi.w, y: roi.y + (box[1] + box[3]) / 2 * roi.h });
    const aligned = followSearchPoint(trail, firstTrack.time, secondTrack.time, center(a));
    const next = center(b);
    if (!aligned || Math.abs(aligned.x - next.x) > .08 || Math.abs(aligned.y - next.y) > .08) return { kind: "wait", message: "The cap moved between views. Hold still and try again." };
    const latest = sample(), tracked = followSearchPoint(trail, secondTrack.time, latest.time, next);
    if (!tracked) return { kind: "wait", message: "The camera moved before verification finished. Keep the cap in view and try again." };
    const view = visible();
    if (tracked.x < view.x || tracked.x > view.x + view.w || tracked.y < view.y || tracked.y > view.y + view.h) return { kind: "wait", message: "The cap moved outside the preview. Center it in the camera view and try again." };
    return { kind: "located", point: tracked, tracking: latest.tracking, inspection: results[1] };
  } finally { window.clearInterval(timer); }
}

export function snapshotVideo(video: HTMLVideoElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image capture unavailable");
  context.drawImage(video, 0, 0);
  return canvas;
}

// Encode immutable captured pixels, rather than cropping a later live frame with an old AI box.
export function encodeSearchCrop(canvas: HTMLCanvasElement, roi: Roi): string {
  const crop = document.createElement("canvas");
  const w = canvas.width * roi.w, h = canvas.height * roi.h;
  const scale = Math.min(1, 1280 / Math.max(w, h));
  crop.width = Math.round(w * scale);
  crop.height = Math.round(h * scale);
  const context = crop.getContext("2d");
  if (!context) throw new Error("Image capture unavailable");
  context.drawImage(canvas, roi.x * canvas.width, roi.y * canvas.height, w, h, 0, 0, crop.width, crop.height);
  return crop.toDataURL("image/jpeg", 0.85).split(",", 2)[1];
}
