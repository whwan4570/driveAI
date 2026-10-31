// 후면 카메라와 ROI(투입구 주변) 크롭 캡처.

/** 영상 크기에 대한 비율(0~1). 거치 후 시작 전에 한 번 정한다. */
export interface Roi {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL_FRAME: Roi = { x: 0, y: 0, w: 1, h: 1 };

export function roiAround(cx: number, cy: number, size = 0.5): Roi {
  const half = size / 2;
  const x = Math.min(Math.max(cx - half, 0), 1 - size);
  const y = Math.min(Math.max(cy - half, 0), 1 - size);
  return { x, y, w: size, h: size };
}

export async function openRearCamera(video: HTMLVideoElement, size: { width: number; height: number } = { width: 1280, height: 720 }): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: "environment" }, width: { ideal: size.width }, height: { ideal: size.height } },
  });
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  return stream;
}

function drawRoi(video: HTMLVideoElement, roi: Roi, canvas: HTMLCanvasElement, maxSide: number) {
  const sx = roi.x * video.videoWidth;
  const sy = roi.y * video.videoHeight;
  const sw = roi.w * video.videoWidth;
  const sh = roi.h * video.videoHeight;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2d context unavailable");
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return ctx;
}

const captureCanvas = document.createElement("canvas");

/** ROI를 잘라 JPEG base64(접두사 없음)로 돌려준다. */
export function grabJpeg(video: HTMLVideoElement, roi: Roi, maxSide = 768, quality = 0.7): string {
  drawRoi(video, roi, captureCanvas, maxSide);
  return captureCanvas.toDataURL("image/jpeg", quality).split(",", 2)[1];
}

const motionCanvas = document.createElement("canvas");

/** 움직임 감지용 저해상도 흑백 샘플. */
export function grabGray(video: HTMLVideoElement, roi: Roi, side = 64): Uint8Array {
  const ctx = drawRoi(video, roi, motionCanvas, side);
  const { data } = ctx.getImageData(0, 0, motionCanvas.width, motionCanvas.height);
  const gray = new Uint8Array(data.length / 4);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = (data[i * 4] * 77 + data[i * 4 + 1] * 150 + data[i * 4 + 2] * 29) >> 8;
  }
  return gray;
}
