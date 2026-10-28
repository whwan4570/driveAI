from __future__ import annotations

from pathlib import Path

import pytest

from carmori.replay import load_clip, run_clip

CLIPS = sorted((Path(__file__).resolve().parents[2] / "fixtures" / "clips").rglob("*.json"))


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
