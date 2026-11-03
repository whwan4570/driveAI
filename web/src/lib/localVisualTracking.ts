export type TrackingPoint = { x: number; y: number };

export type TrackingFrame = {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
};

export function frameDifference(first: Uint8Array, second: Uint8Array): number {
  if (first.length !== second.length || !first.length) return Infinity;
  return first.reduce((sum, value, index) => sum + Math.abs(value - second[index]), 0) / first.length;
}

const canvas = document.createElement("canvas");

/** A small local frame is enough for moving a verified cue between Muse checks. */
export function captureTrackingFrame(video: HTMLVideoElement): TrackingFrame {
  const scale = Math.min(1, 320 / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Camera tracking is unavailable");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data };
}

function patchError(previous: TrackingFrame, current: TrackingFrame, fromX: number, fromY: number, toX: number, toY: number, radius: number): number {
  let error = 0;
  let samples = 0;
  for (let dy = -radius; dy <= radius; dy += 2) {
    for (let dx = -radius; dx <= radius; dx += 2) {
      const oldIndex = ((fromY + dy) * previous.width + fromX + dx) * 4;
      const newIndex = ((toY + dy) * current.width + toX + dx) * 4;
      error += Math.abs(previous.pixels[oldIndex] - current.pixels[newIndex]);
      error += Math.abs(previous.pixels[oldIndex + 1] - current.pixels[newIndex + 1]);
      error += Math.abs(previous.pixels[oldIndex + 2] - current.pixels[newIndex + 2]);
      samples += 3;
    }
  }
  return error / samples;
}

function patchContrast(frame: TrackingFrame, x: number, y: number, radius: number): number {
  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let dy = -radius; dy <= radius; dy += 2) {
    for (let dx = -radius; dx <= radius; dx += 2) {
      const index = ((y + dy) * frame.width + x + dx) * 4;
      const value = (frame.pixels[index] + frame.pixels[index + 1] + frame.pixels[index + 2]) / 3;
      sum += value;
      sumSquares += value * value;
      count++;
    }
  }
  return Math.sqrt(Math.max(0, sumSquares / count - (sum / count) ** 2));
}

/** Match a verified target's nearby texture in the next camera frame. Return null when uncertain. */
export function trackPointLocally(previous: TrackingFrame, current: TrackingFrame, point: TrackingPoint): TrackingPoint | null {
  if (previous.width !== current.width || previous.height !== current.height) return null;
  const { width, height } = current;
  const radius = Math.max(7, Math.round(Math.min(width, height) * 0.038));
  const fromX = Math.round(point.x * width);
  const fromY = Math.round(point.y * height);
  if (fromX < radius || fromY < radius || fromX + radius >= width || fromY + radius >= height) return null;
  if (patchContrast(previous, fromX, fromY, radius) < 8) return null;
  // A stationary phone should keep the verified cue without searching for a lookalike part.
  if (patchError(previous, current, fromX, fromY, fromX, fromY, radius) < 4) return point;
  // Keep an even radius so the two-pixel search grid includes zero displacement.
  const search = Math.max(14, 2 * Math.round(Math.min(width, height) * 0.085 / 2));
  let best = { x: fromX, y: fromY, error: Infinity };
  let runnerUp = Infinity;
  for (let y = Math.max(radius, fromY - search); y <= Math.min(height - radius - 1, fromY + search); y += 2) {
    for (let x = Math.max(radius, fromX - search); x <= Math.min(width - radius - 1, fromX + search); x += 2) {
      const error = patchError(previous, current, fromX, fromY, x, y, radius);
      if (error < best.error) {
        if (Math.hypot(x - best.x, y - best.y) > 4) runnerUp = Math.min(runnerUp, best.error);
        best = { x, y, error };
      } else if (Math.hypot(x - best.x, y - best.y) > 4) {
        runnerUp = Math.min(runnerUp, error);
      }
    }
  }
  // A large appearance change or several equally plausible locations means the cue is lost.
  if (best.error > 32 || (runnerUp < Infinity && runnerUp - best.error < 1.8)) return null;
  return { x: best.x / width, y: best.y / height };
}
