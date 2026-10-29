from __future__ import annotations

from pathlib import Path

import pytest

from carmori.replay import load_clip, run_clip

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
