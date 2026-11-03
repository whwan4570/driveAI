// Pure helpers for the tire camera guide. The outline only shows where the model saw the tire;
// it never decides whether a shot passes.

export type Box = [number, number, number, number];
export interface Size { width: number; height: number }

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
