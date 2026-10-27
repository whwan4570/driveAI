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
