import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

type Point = { x: number; y: number };
type Incoming = { type: "init" } | { type: "frame"; bitmap: ImageBitmap; timestamp: number };
type Outgoing = { type: "ready" } | { type: "result"; hands: Point[][] } | { type: "error"; message: string };

let tracker: HandLandmarker | null = null;
let lastTimestamp = -1;
const send = (message: Outgoing) => self.postMessage(message);

self.onmessage = async (event: MessageEvent<Incoming>) => {
  const message = event.data;
  if (message.type === "init") {
    try {
      const wasm = await FilesetResolver.forVisionTasks("/mediapipe/wasm", true);
      tracker = await HandLandmarker.createFromOptions(wasm, {
        baseOptions: { modelAssetPath: "/mediapipe/hand_landmarker.task", delegate: "CPU" },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.55,
        minTrackingConfidence: 0.55,
      });
      send({ type: "ready" });
    } catch (error) {
      send({ type: "error", message: error instanceof Error ? error.message : "Hand tracking could not start" });
    }
    return;
  }
  try {
    if (!tracker || message.timestamp <= lastTimestamp) {
      send({ type: "result", hands: [] });
      return;
    }
    lastTimestamp = message.timestamp;
    const result = tracker.detectForVideo(message.bitmap, message.timestamp);
    send({ type: "result", hands: result.landmarks.map((hand) => hand.map(({ x, y }) => ({ x, y }))) });
  } catch (error) {
    send({ type: "error", message: error instanceof Error ? error.message : "Hand tracking stopped" });
  } finally {
    message.bitmap.close();
  }
};
