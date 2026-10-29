from __future__ import annotations

import io
import json

import pytest
from PIL import Image

from carmori.annotate import FULL_FRAME, main, prepare_frame, roi_around
from carmori.replay import load_clip, run_clip


def jpeg(size: tuple[int, int]) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", size, (90, 120, 150)).save(out, format="JPEG")
    return out.getvalue()


def test_roi_matches_live_camera_math():
    assert roi_around(0.5, 0.5) == (0.25, 0.25, 0.5, 0.5)
    # 가장자리를 탭해도 화면 안쪽으로 붙는다.
    assert roi_around(0.95, 0.02) == (0.5, 0.0, 0.5, 0.5)


def test_prepare_frame_crops_and_limits_long_side():
    full = Image.open(io.BytesIO(prepare_frame(jpeg((1920, 1080)), FULL_FRAME)))
    assert full.size == (768, 432)
    crop = Image.open(io.BytesIO(prepare_frame(jpeg((1280, 720)), roi_around(0.5, 0.5))))
    assert crop.size == (640, 360)


@pytest.fixture
def isolated_env(monkeypatch):
    # .env 로딩이 테스트 밖으로 새지 않도록 원래 값을 기록해 둔다.
    for name in ("META_API_KEY", "SPARK_REASONING_EFFORT", "SPARK_VISION_MODEL"):
        monkeypatch.setenv(name, "")
        monkeypatch.delenv(name)
    monkeypatch.setenv("CARMORI_SPARK", "fake")


def test_cli_writes_expectation_and_annotation(tmp_path, isolated_env):
    frames = tmp_path / "frames"
    frames.mkdir()
    for i in range(1, 7):
        (frames / f"{i:05d}.jpg").write_bytes(jpeg((1280, 720)))
    env = tmp_path / ".env"
    env.write_text("SPARK_REASONING_EFFORT=low\nCARMORI_SPARK=meta\n")
    out = tmp_path / "recorded" / "occluded_01.json"

    main([str(frames), "--name", "occluded_01", "--roi", "0.6,0.4", "--final-step", "FIND_INLET",
          "--waiting-reason", "OCCLUDED", "--env-file", str(env), "--out", str(out)])

    clip = json.loads(out.read_text())
    assert clip["expect"] == {"final_step": "FIND_INLET", "completion_source": None, "waiting_reason": "OCCLUDED"}
    meta = clip["annotation"]
    # .env 값은 채우되, 이미 export한 값(CARMORI_SPARK=fake)은 덮지 않는다.
    assert meta["reasoning_effort"] == "low" and meta["spark_mode"] == "fake"
    assert meta["roi"] == [0.35, 0.15, 0.5, 0.5] and meta["fps"] == 2.0
    assert [e["frames"] for e in clip["events"]] == [["00001", "00002"], ["00003", "00004"], ["00005", "00006"]]
    run_clip(load_clip(out))


def test_cli_rejects_point_outside_frame(tmp_path, isolated_env):
    with pytest.raises(SystemExit):
        main([str(tmp_path), "--name", "x", "--roi", "1.2,0.5", "--final-step", "FIND_INLET", "--out", str(tmp_path / "x.json")])
