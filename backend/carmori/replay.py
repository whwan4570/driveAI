"""리플레이 하네스: 녹화 클립의 Spark 응답 캐시를 상태 머신에 다시 흘려본다.

클립 JSON의 관찰은 모든 항목을 물어본 응답(annotate.py, step=None)이라서,
전환 규칙을 바꿔도 API를 다시 부르지 않고 같은 클립으로 평가할 수 있다.

    python -m carmori.replay ../fixtures/clips
    python -m carmori.replay ../fixtures/clips/normal_observed.json -v
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from .models import CompletionSource, Observation, SceneAnswer, Step, VoiceIntent, WaitReason
from .state_machine import DEFAULT_RULES, Rules, TransitionResult, apply_voice, new_session, transition
from .vehicles import DEMO_SPEC, VehicleSpec, get_spec

EPOCH = datetime(2026, 1, 1, tzinfo=timezone.utc)


class ClipEvent(BaseModel):
    t: float
    seq: int | None = None
    frames: list[str] = Field(default_factory=list)
    answer: SceneAnswer | None = None
    voice: VoiceIntent | None = None
    via: Literal["voice", "touch"] = "voice"
    # 서버가 이 관찰을 처리한 시각(초). 없으면 t + latency.
    arrives: float | None = None


class ClipExpect(BaseModel):
    final_step: Step
    completion_source: CompletionSource | None = None
    waiting_reason: WaitReason | None = None


class Clip(BaseModel):
    name: str
    description: str = ""
    source: str = "synthetic"  # synthetic | recorded
    spec_id: str = DEMO_SPEC.spec_id
    expect: ClipExpect
    events: list[ClipEvent]


@dataclass
class ReplayReport:
    clip: Clip
    final_step: Step
    waiting_reason: WaitReason | None
    records: list[CompletionSource] = field(default_factory=list)
    transitions: list[tuple[float, Step, Step, str]] = field(default_factory=list)
    hints: list[tuple[float, str]] = field(default_factory=list)
    rejected: Counter = field(default_factory=Counter)
    failures: list[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return not self.failures


def load_clip(path: Path) -> Clip:
    return Clip.model_validate(json.loads(path.read_text(encoding="utf-8")))


def run_clip(clip: Clip, *, rules: Rules = DEFAULT_RULES, latency_s: float = 2.5) -> ReplayReport:
    spec: VehicleSpec | None = get_spec(clip.spec_id)
    if spec is None:
        raise ValueError(f"{clip.name}: unknown spec_id {clip.spec_id}")
    state = new_session(f"replay-{clip.name}", "replay-vehicle")
    report = ReplayReport(clip=clip, final_step=state.step, waiting_reason=None)

    for event in clip.events:
        now = EPOCH + timedelta(seconds=event.arrives if event.arrives is not None else event.t + latency_s)
        before = state.step
        if event.voice is not None:
            result = apply_voice(state, event.voice, now=now, via=event.via)
        elif event.answer is not None and event.seq is not None:
            obs = Observation(
                session_id=state.session_id,
                sequence_id=event.seq,
                step=state.step,
                attempt=state.attempt,
                captured_at=EPOCH + timedelta(seconds=event.t),
                frame_ids=event.frames,
                answer=event.answer,
                model_version="replay",
            )
            result = transition(state, obs, now=now, spec=spec, rules=rules)
        else:
            raise ValueError(f"{clip.name}: event at t={event.t} needs answer+seq or voice")
        _collect(report, event.t, before, result)
        state = result.state

    report.final_step = state.step
    report.waiting_reason = state.waiting_reason
    _check(report)
    return report


def _collect(report: ReplayReport, t: float, before: Step, result: TransitionResult) -> None:
    if not result.accepted:
        report.rejected[result.reason] += 1
    if result.state.step is not before:
        report.transitions.append((t, before, result.state.step, result.reason))
    if result.spoken_hint:
        report.hints.append((t, result.spoken_hint))
    if result.completion is not None:
        report.records.append(result.completion.completion_source)


def _check(report: ReplayReport) -> None:
    expect = report.clip.expect
    if report.final_step is not expect.final_step:
        report.failures.append(f"final_step {report.final_step.value} != {expect.final_step.value}")
    if report.waiting_reason is not expect.waiting_reason:
        got = report.waiting_reason.value if report.waiting_reason else None
        want = expect.waiting_reason.value if expect.waiting_reason else None
        report.failures.append(f"waiting_reason {got} != {want}")
    want_records = [expect.completion_source] if expect.completion_source else []
    if report.records != want_records:
        report.failures.append(
            f"records {[r.value for r in report.records]} != {[r.value for r in want_records]}"
        )


def _clip_paths(targets: list[str]) -> list[Path]:
    paths: list[Path] = []
    for target in targets:
        p = Path(target)
        paths.extend(sorted(p.glob("*.json")) if p.is_dir() else [p])
    return paths


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Replay clip fixtures through the state machine")
    parser.add_argument("targets", nargs="+", help="clip JSON files or directories")
    parser.add_argument("--latency", type=float, default=2.5, help="simulated model latency (s)")
    parser.add_argument("--agreements", type=int, default=DEFAULT_RULES.required_agreements)
    parser.add_argument("--max-age", type=float, default=DEFAULT_RULES.max_frame_age.total_seconds())
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    rules = Rules(max_frame_age=timedelta(seconds=args.max_age), required_agreements=args.agreements)
    reports = [run_clip(load_clip(p), rules=rules, latency_s=args.latency) for p in _clip_paths(args.targets)]

    for r in reports:
        mark = "PASS" if r.passed else "FAIL"
        records = ",".join(s.value for s in r.records) or "-"
        rejected = ",".join(f"{k}:{v}" for k, v in sorted(r.rejected.items())) or "-"
        print(f"{mark}  {r.clip.name:<32} final={r.final_step.value:<16} records={records:<22} rejected={rejected}")
        for failure in r.failures:
            print(f"      ! {failure}")
        if args.verbose:
            for t, a, b, reason in r.transitions:
                print(f"      t={t:>5.1f}s  {a.value} -> {b.value}  ({reason})")
            for t, hint in r.hints:
                print(f"      t={t:>5.1f}s  say: {hint}")

    failed = sum(not r.passed for r in reports)
    wrong_records = sum(len(r.records) for r in reports if r.clip.expect.completion_source is None)
    print(f"\n{len(reports) - failed}/{len(reports)} clips passed · 잘못된 자동 기록 {wrong_records}건")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
