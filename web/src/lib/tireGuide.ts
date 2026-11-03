// Pure helpers for the tire camera guide. The outline only shows where the model saw the tire;
// it never decides whether a shot passes.
import { trackPointLocally, type TrackingFrame } from "./localVisualTracking";

export type Box = [number, number, number, number];
export interface Size { width: number; height: number }

/** Follow several textured parts of a Muse-confirmed tire. Never use this to approve a photo. */
export function trackTireBoxLocally(previous: TrackingFrame, current: TrackingFrame, box: Box): Box | null {
  const offsets = [
    [0.25, 0.25], [0.5, 0.25], [0.75, 0.25],
    [0.25, 0.5], [0.5, 0.5], [0.75, 0.5],
    [0.25, 0.75], [0.5, 0.75], [0.75, 0.75],
  ];
  const shifts = offsets.flatMap(([u, v]) => {
    const point = { x: box[0] + (box[2] - box[0]) * u, y: box[1] + (box[3] - box[1]) * v };
    const next = trackPointLocally(previous, current, point);
    return next ? [{ x: next.x - point.x, y: next.y - point.y }] : [];
  });
  if (shifts.length < 3) return null;
  const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const dx = median(shifts.map((shift) => shift.x));
  const dy = median(shifts.map((shift) => shift.y));
  const agreeing = shifts.filter((shift) => Math.hypot(shift.x - dx, shift.y - dy) < 0.025);
  if (agreeing.length < 3 || Math.hypot(dx, dy) > 0.1) return null;
  const moved: Box = [box[0] + dx, box[1] + dy, box[2] + dx, box[3] + dy];
  return moved.every((edge) => edge >= 0 && edge <= 1) ? moved : null;
}

/** Maps a 0–1 box in the video frame to pixels in a viewport that shows the video with object-fit: cover. */
export function boxOnCoverView(box: Box, video: Size, view: Size): { left: number; top: number; width: number; height: number } {
  const scale = Math.max(view.width / video.width, view.height / video.height);
  const shownWidth = video.width * scale;
  const shownHeight = video.height * scale;
  const offsetX = (shownWidth - view.width) / 2;
  const offsetY = (shownHeight - view.height) / 2;
  return {
    left: box[0] * shownWidth - offsetX,
    top: box[1] * shownHeight - offsetY,
    width: (box[2] - box[0]) * shownWidth,
    height: (box[3] - box[1]) * shownHeight,
  };
}

/** Which way to point the phone so the tire sits in the middle. Null when it is already centered. */
export function aimHint(box: Box): string | null {
  const dx = (box[0] + box[2]) / 2 - 0.5;
  const dy = (box[1] + box[3]) / 2 - 0.5;
  if (Math.abs(dx) < 0.18 && Math.abs(dy) < 0.18) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "Aim the phone right" : "Aim the phone left";
  return dy > 0 ? "Aim the phone down" : "Aim the phone up";
}

export function averageBrightness(frame: Uint8Array): number {
  let total = 0;
  for (let i = 0; i < frame.length; i++) total += frame[i];
  return frame.length ? total / frame.length : 0;
}
