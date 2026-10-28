// ROI 안의 움직임을 보고 "동작이 끝난 순간"에만 Spark 호출을 트리거한다.
// 정적인 장면(투입구 찾기 등)을 위해 움직임이 없으면 idleProbeMs마다 한 번 확인한다.
// 수치는 Day 2 실측으로 조정하는 초기값이다.

export interface MotionGateOptions {
  /** 프레임 간 평균 밝기 차이(0~1)가 이 값을 넘으면 움직임으로 본다. */
  moveThreshold: number;
  /** 이보다 짧게 움직였다 멈추면 잡음으로 버린다. */
  minMoveMs: number;
  /** 움직임이 이만큼 없으면 "멈춤"으로 본다. */
  settleMs: number;
  /** 움직임이 없을 때 주기적으로 확인하는 간격. */
  idleProbeMs: number;
}

export const DEFAULT_MOTION_OPTIONS: MotionGateOptions = {
  moveThreshold: 0.04,
  minMoveMs: 300,
  settleMs: 700,
  idleProbeMs: 4000,
};

export type TriggerReason = "settled" | "idle" | "hand_left_roi";

export class MotionGate {
  private prev: Uint8Array | null = null;
  private movingSince: number | null = null;
  private lastMoveAt = 0;
  private lastTriggerAt = 0;
  lastDiff = 0;

  constructor(
    private readonly onTrigger: (reason: TriggerReason) => void,
    private readonly opts: MotionGateOptions = DEFAULT_MOTION_OPTIONS,
  ) {}

  reset(now: number) {
    this.prev = null;
    this.movingSince = null;
    this.lastTriggerAt = now;
  }

  sample(gray: Uint8Array, now: number) {
    const prev = this.prev;
    this.prev = gray;
    if (!prev || prev.length !== gray.length) return;

    let sum = 0;
    for (let i = 0; i < gray.length; i++) sum += Math.abs(gray[i] - prev[i]);
    const diff = sum / gray.length / 255;
    this.lastDiff = diff;

    if (diff > this.opts.moveThreshold) {
      if (this.movingSince === null) this.movingSince = now;
      this.lastMoveAt = now;
      return;
    }

    if (this.movingSince !== null) {
      if (now - this.lastMoveAt < this.opts.settleMs) return;
      const movedFor = this.lastMoveAt - this.movingSince;
      this.movingSince = null;
      if (movedFor >= this.opts.minMoveMs) this.fire("settled", now);
      return;
    }

    if (now - this.lastTriggerAt >= this.opts.idleProbeMs) this.fire("idle", now);
  }

  private fire(reason: TriggerReason, now: number) {
    this.lastTriggerAt = now;
    this.onTrigger(reason);
  }
}
