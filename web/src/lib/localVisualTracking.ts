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
  let radius = Math.max(7, Math.round(Math.min(width, height) * 0.038));
  const fromX = Math.round(point.x * width);
  const fromY = Math.round(point.y * height);
  if (fromX < radius || fromY < radius || fromX + radius >= width || fromY + radius >= height) return null;
  // A cap's center can be plain blue. Include its rim/neck before declaring it untrackable.
  if (patchContrast(previous, fromX, fromY, radius) < 8) {
    const contextRadius = radius * 2;
    if (fromX < contextRadius || fromY < contextRadius || fromX + contextRadius >= width || fromY + contextRadius >= height || patchContrast(previous, fromX, fromY, contextRadius) < 8) return null;
    radius = contextRadius;
  }
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

/** Color is only a tracking cue for a cap already verified by AI, never an identity check. */
export function trackVerifiedInlet(previous: TrackingFrame, current: TrackingFrame, point: TrackingPoint): TrackingPoint | null {
  if (previous.width !== current.width || previous.height !== current.height) return null;
  const { width, height } = previous;
  const cx = Math.round(point.x * width), cy = Math.round(point.y * height);
  const blue = (frame: TrackingFrame, x: number, y: number) => {
    const i = (y * width + x) * 4;
    const r = frame.pixels[i], g = frame.pixels[i + 1], b = frame.pixels[i + 2];
    return b > r + 12 && b > g * 1.06 && b > 35;
  };
  const radius = Math.max(8, Math.round(Math.min(width, height) * .065));
  let oldBlue = 0;
  for (let y = Math.max(0, cy - radius); y <= Math.min(height - 1, cy + radius); y++) for (let x = Math.max(0, cx - radius); x <= Math.min(width - 1, cx + radius); x++) if (blue(previous, x, y)) oldBlue++;
  if (oldBlue < Math.max(8, (2 * radius + 1) ** 2 * .35)) return trackPointLocally(previous, current, point);
  const search = Math.max(16, Math.round(Math.min(width, height) * .14));
  const x0 = Math.max(0, cx - search), x1 = Math.min(width - 1, cx + search);
  const y0 = Math.max(0, cy - search), y1 = Math.min(height - 1, cy + search);
  const seen = new Set<number>();
  const candidates: { x: number; y: number; count: number; distance: number }[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const start = y * width + x;
    if (seen.has(start) || !blue(current, x, y)) continue;
    const queue = [start]; seen.add(start);
    let sumX = 0, sumY = 0, count = 0, edge = false;
    for (let i = 0; i < queue.length; i++) {
      const px = queue[i] % width, py = Math.floor(queue[i] / width);
      sumX += px; sumY += py; count++;
      if (px === 0 || py === 0 || px === width - 1 || py === height - 1 || px === x0 || px === x1 || py === y0 || py === y1) edge = true;
      for (const [nx, ny] of [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]]) {
        const key = ny * width + nx;
        if (nx < x0 || nx > x1 || ny < y0 || ny > y1 || seen.has(key) || !blue(current, nx, ny)) continue;
        seen.add(key); queue.push(key);
      }
    }
    if (!edge && count >= Math.max(8, oldBlue * .25) && count <= oldBlue * 5) {
      const x = sumX / count, y = sumY / count;
      candidates.push({ x, y, count, distance: Math.hypot(x - cx, y - cy) });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  const best = candidates[0];
  if (!best || (candidates[1] && candidates[1].distance - best.distance < 6)) return null;
  return { x: best.x / width, y: best.y / height };
}
