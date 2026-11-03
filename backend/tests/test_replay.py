from __future__ import annotations

from pathlib import Path

import pytest

from carmori.clip_cases import CASES
from carmori.models import CompletionSource, Step, WaitReason
from carmori.replay import ClipExpect, load_clip, outcome, render_report, run_clip

CLIPS_DIR = Path(__file__).resolve().parents[2] / "fixtures" / "clips"
# 합성 클립만 통과를 요구한다. recorded/의 실차 클립은 평가 데이터라 실패가 정상일 수 있다.
CLIPS = sorted(CLIPS_DIR.glob("*.json"))
RECORDED = sorted((CLIPS_DIR / "recorded").glob("*.json"))


def test_fixtures_exist():
    assert CLIPS, "fixtures/clips 아래에 클립이 없습니다"


@pytest.mark.parametrize("path", CLIPS, ids=lambda p: p.stem)
def test_clip_meets_expectation(path: Path):
    report = run_clip(load_clip(path))
    assert report.passed, f"{path.stem}: {report.failures}"


# 실측한 Spark 관찰 응답은 약 9초였다. 느린 모델에서도 같은 판정이 나와야 한다.
@pytest.mark.parametrize("path", CLIPS, ids=lambda p: p.stem)
def test_clip_holds_with_measured_model_latency(path: Path):
    report = run_clip(load_clip(path), latency_s=9.2)
    assert report.passed, f"{path.stem}: {report.failures}"


@pytest.mark.parametrize("path", RECORDED, ids=lambda p: p.stem)
def test_recorded_clip_is_valid(path: Path):
    clip = load_clip(path)
    assert clip.source == "recorded" and clip.events


def _failed_report(name: str, **expect):
    clip = load_clip(CLIPS_DIR / "normal_observed.json").model_copy(deep=True)
    clip.name = name
    clip.expect = ClipExpect(**expect)
    return run_clip(clip)


def test_clip_outcomes_separate_safety_failures():
    assert outcome(run_clip(load_clip(CLIPS_DIR / "normal_observed.json"))) == "pass"
    assert outcome(_failed_report("a", final_step=Step.OPEN_CAP)) == "too_far"
    assert outcome(_failed_report("b", final_step=Step.RECORDED, completion_source=CompletionSource.USER_VOICE_CONFIRMED)) == "wrong_record"
    stuck = load_clip(CLIPS_DIR / "hand_only.json").model_copy(deep=True)
    stuck.expect = ClipExpect(final_step=Step.RECORDED, completion_source=CompletionSource.OBSERVED_SEQUENCE)
    assert outcome(run_clip(stuck)) == "stuck"
    waiting = load_clip(CLIPS_DIR / "wrong_bottle.json").model_copy(deep=True)
    waiting.expect = ClipExpect(final_step=Step.CONFIRM_PRODUCT, waiting_reason=WaitReason.PRODUCT_UNKNOWN)
    assert outcome(run_clip(waiting)) == "wrong_wait"


def test_report_lists_failures_first_and_cases_not_shot():
    good = load_clip(CLIPS_DIR / "normal_observed.json").model_copy(deep=True)
    good.annotation = {"case": "normal", "model": "m", "reasoning_effort": "low", "max_side": 1280, "spark_mode": "meta"}
    bad = _failed_report("z_too_far", final_step=Step.OPEN_CAP)
    bad.clip.annotation = {"case": "hand_only", "model": "m", "reasoning_effort": "low", "max_side": 1280, "spark_mode": "meta"}
    report = render_report([run_clip(good), bad])
    assert "Passed 1 of 2" in report and "Safety failures: 1" in report
    rows = [line for line in report.splitlines() if line.startswith("| ") and "Clip" not in line]
    assert rows[0].startswith("| z_too_far")
    assert "Advanced too far" in report
    assert "coffee_cup" in report.split("Cases not shot yet:")[1]
    assert "hand_only" not in report.split("Cases not shot yet:")[1]


def test_report_warns_when_answers_are_not_from_the_real_model():
    clip = load_clip(CLIPS_DIR / "normal_observed.json").model_copy(deep=True)
    clip.annotation = {"case": "normal", "spark_mode": "fake"}
    assert "not annotated by the real model" in render_report([run_clip(clip)])


def test_every_case_expectation_is_complete():
    assert len({case.id for case in CASES}) == len(CASES)
    for case in CASES:
        assert case.checks and case.shoot and case.seconds > 0
        if case.final_step is Step.RECORDED:
            assert case.completion_source is not None
        else:
            assert case.completion_source is None

