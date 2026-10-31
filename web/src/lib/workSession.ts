// 작업 세션 관찰 루프.
// 움직임이 멈추면 겹치지 않는 프레임 묶음 2개를 찍어 한 요청으로 보낸다.
// 서버는 두 묶음을 Spark에 동시에 묻고, 둘이 일치할 때만 단계를 넘긴다.
// 요청은 하나만 진행하고, 진행 중에 생긴 트리거는 버린다.

import { api, type SessionUpdate, type WindowIn } from "./api";
import { grabGray, grabJpeg, type Roi } from "./camera";
import { MotionGate, type TriggerReason } from "./motionGate";

const SAMPLE_INTERVAL_MS = 125;
const FRAMES_PER_WINDOW = 2;
const FRAME_GAP_MS = 400;
const WINDOW_GAP_MS = 600;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface WorkSessionDeps {
  video: HTMLVideoElement;
  getRoi: () => Roi;
  /** Longest side of observation frames; the label step needs more pixels than the inlet steps. */
  getMaxSide: () => number;
  sessionId: string;
  stateVersion: number;
  onUpdate: (update: SessionUpdate, trigger: TriggerReason) => void;
  onError: (error: unknown) => void;
}

export class WorkSessionController {
  private timer: number | null = null;
  private inFlight = false;
  private paused = false;
  private seq = 0;
  private epoch = 0;
  private stateVersion: number;
  private readonly gate: MotionGate;
  private handNearFrames = 0;
  private handAwayFrames = 0;
  private handWasNear = false;
  private lastHandTriggerAt = 0;

  constructor(private readonly deps: WorkSessionDeps) {
    this.stateVersion = deps.stateVersion;
    this.gate = new MotionGate((reason) => void this.onTrigger(reason));
  }

  start() {
    if (this.timer !== null) return;
    this.gate.reset(performance.now());
    this.timer = window.setInterval(this.tick, SAMPLE_INTERVAL_MS);
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.epoch++;
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    this.epoch++;
    if (!paused) this.gate.reset(performance.now());
  }

  setStateVersion(version: number) {
    this.stateVersion = version;
  }

  /** 음성 명령으로 서버 상태가 바뀌면 진행 중인 응답을 버린다. */
  invalidateInFlight() {
    this.epoch++;
  }

  get motion() {
    return this.gate.lastDiff;
  }

  /** 손이 작업 영역을 벗어난 뒤 다시 서버 시각 판정을 요청한다. 손 위치만으로 단계는 완료하지 않는다. */
  updateHandNearInlet(near: boolean) {
    if (this.paused || this.timer === null) return;
    if (near) {
      this.handNearFrames++;
      this.handAwayFrames = 0;
      if (this.handNearFrames >= 2) this.handWasNear = true;
      return;
    }
    this.handNearFrames = 0;
    if (!this.handWasNear || ++this.handAwayFrames < 2) return;
    this.handWasNear = false;
    this.handAwayFrames = 0;
    const now = performance.now();
    if (now - this.lastHandTriggerAt < 3000) return;
    this.lastHandTriggerAt = now;
    void this.onTrigger("hand_left_roi");
  }

  private tick = () => {
    const { video, getRoi } = this.deps;
    if (this.paused || this.inFlight || video.readyState < 2) return;
    this.gate.sample(grabGray(video, getRoi()), performance.now());
  };

  private async captureWindow(): Promise<WindowIn> {
    const sequence_id = ++this.seq;
    const frames = [];
    for (let i = 0; i < FRAMES_PER_WINDOW; i++) {
      if (i > 0) await sleep(FRAME_GAP_MS);
      frames.push({
        frame_id: `${this.deps.sessionId.slice(0, 8)}-${sequence_id}-${i}`,
        captured_at: new Date().toISOString(),
        jpeg_base64: grabJpeg(this.deps.video, this.deps.getRoi(), this.deps.getMaxSide(), 0.8),
      });
    }
    return { sequence_id, frames };
  }

  private async onTrigger(reason: TriggerReason) {
    if (this.inFlight || this.paused) return;
    this.inFlight = true;
    const epoch = this.epoch;
    const expectedVersion = this.stateVersion;
    try {
      const first = await this.captureWindow();
      await sleep(WINDOW_GAP_MS);
      const second = await this.captureWindow();
      const update = await api.observe(this.deps.sessionId, [first, second], expectedVersion);
      if (epoch === this.epoch) this.deps.onUpdate(update, reason);
    } catch (error) {
      if (epoch === this.epoch) this.deps.onError(error);
    } finally {
      this.inFlight = false;
      this.gate.reset(performance.now());
    }
  }
}
