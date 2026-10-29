"""녹화 프레임 → 리플레이 클립 JSON.

실차 클립을 2fps JPEG로 뽑아 두고, 묶음마다 Spark에 '모든 항목'을 한 번만 물어
캐시한다. 이후 규칙 조정은 replay.py로 API 비용 없이 반복한다.

    ffmpeg -i recordings/normal_01.mp4 -vf fps=2 fixtures/frames/normal_01/%05d.jpg
    python -m carmori.annotate ../fixtures/frames/normal_01 --name normal_01 \
        --roi 0.55,0.40 --final-step RECORDED --completion-source observed_sequence \
        --out ../fixtures/clips/recorded/normal_01.json

프레임은 라이브와 같게 ROI(--roi 탭 위치, 기본 크기 0.5)를 자르고 긴 변 768px,
JPEG 품질 70으로 다시 인코딩해 보낸다. 라이브가 보내는 직전 단계 참고 프레임은
step=None 질의라서 붙이지 않는다.

키와 모델 설정은 저장소 루트 .env에서 읽는다(이미 export한 값이 우선).
expect 값은 사람이 영상을 보고 정한 정답이다. 모델 응답에서 만들지 않는다.
"""

from __future__ import annotations

import argparse
import asyncio
import io
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from PIL import Image

from .config import Settings
from .models import CompletionSource, Step, WaitReason
from .spark import SparkClient, make_spark_client

REPO_ENV = Path(__file__).resolve().parents[2] / ".env"
MAX_SIDE = 768
JPEG_QUALITY = 70

Roi = tuple[float, float, float, float]
FULL_FRAME: Roi = (0.0, 0.0, 1.0, 1.0)


def roi_around(cx: float, cy: float, size: float = 0.5) -> Roi:
    """web/src/lib/camera.ts roiAround와 같은 계산: 탭 위치 중심, 화면 밖으로 넘지 않게."""
    half = size / 2
    x = min(max(cx - half, 0.0), 1 - size)
    y = min(max(cy - half, 0.0), 1 - size)
    return (x, y, size, size)


def prepare_frame(data: bytes, roi: Roi = FULL_FRAME, *, max_side: int = MAX_SIDE) -> bytes:
    """라이브 grabJpeg처럼 ROI를 자르고 긴 변을 max_side 이하로 줄여 JPEG로 만든다."""
    image = Image.open(io.BytesIO(data)).convert("RGB")
    w, h = image.size
    x, y, rw, rh = roi
    crop = image.crop((round(x * w), round(y * h), round((x + rw) * w), round((y + rh) * h)))
    scale = min(1.0, max_side / max(crop.size))
    if scale < 1:
        crop = crop.resize((round(crop.width * scale), round(crop.height * scale)), Image.Resampling.BILINEAR)
    out = io.BytesIO()
    crop.save(out, format="JPEG", quality=JPEG_QUALITY)
    return out.getvalue()


async def annotate(
    frames_dir: Path, *, spark: SparkClient, fps: float, window: int, stride: int, roi: Roi = FULL_FRAME
) -> list[dict]:
    paths = sorted(frames_dir.glob("*.jpg"))
    events: list[dict] = []
    seq = 0
    # 묶음끼리 프레임이 겹치지 않도록 stride >= window를 권장한다.
    for start in range(0, len(paths) - window + 1, stride):
        chunk = paths[start : start + window]
        answer = await spark.analyze([prepare_frame(p.read_bytes(), roi) for p in chunk], step=None)
        seq += 1
        events.append(
            {
                "t": round((start + window - 1) / fps, 2),
                "seq": seq,
                "frames": [p.stem for p in chunk],
                "answer": answer.model_dump(mode="json", exclude_defaults=True),
            }
        )
    return events


def _point(text: str) -> tuple[float, float]:
    try:
        cx, cy = (float(v) for v in text.split(","))
    except ValueError:
        raise argparse.ArgumentTypeError("use X,Y between 0 and 1, e.g. 0.55,0.40") from None
    if not (0 <= cx <= 1 and 0 <= cy <= 1):
        raise argparse.ArgumentTypeError("X and Y must be between 0 and 1")
    return cx, cy


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("frames_dir", type=Path)
    parser.add_argument("--name", required=True)
    parser.add_argument("--description", default="")
    parser.add_argument("--fps", type=float, default=2.0)
    parser.add_argument("--window", type=int, default=2)
    parser.add_argument("--stride", type=int, default=2)
    parser.add_argument("--roi", type=_point, default=None, help="tapped inlet point X,Y as fractions of the frame")
    parser.add_argument("--roi-size", type=float, default=0.5)
    parser.add_argument("--final-step", type=Step, required=True)
    parser.add_argument("--completion-source", type=CompletionSource, default=None)
    parser.add_argument("--waiting-reason", type=WaitReason, default=None)
    parser.add_argument("--env-file", type=Path, default=REPO_ENV)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)

    if args.env_file.is_file():
        load_dotenv(args.env_file, override=False)
    settings = Settings.from_env()
    if settings.spark_mode != "meta":
        print(f"warning: spark={settings.spark_mode}, answers are not from the model", file=sys.stderr)
    roi = roi_around(*args.roi, size=args.roi_size) if args.roi else FULL_FRAME

    events = asyncio.run(annotate(
        args.frames_dir, spark=make_spark_client(settings), fps=args.fps, window=args.window, stride=args.stride, roi=roi,
    ))
    clip = {
        "name": args.name,
        "description": args.description,
        "source": "recorded",
        "annotation": {
            "spark_mode": settings.spark_mode,
            "model": settings.spark_vision_model,
            "reasoning_effort": settings.spark_reasoning_effort or None,
            "fps": args.fps,
            "window": args.window,
            "stride": args.stride,
            "roi": [round(v, 4) for v in roi],
            "max_side": MAX_SIDE,
            "annotated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        },
        "expect": {
            "final_step": args.final_step.value,
            "completion_source": args.completion_source.value if args.completion_source else None,
            "waiting_reason": args.waiting_reason.value if args.waiting_reason else None,
        },
        "events": events,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(clip, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    effort = settings.spark_reasoning_effort or "default"
    print(f"wrote {args.out} ({len(events)} windows, {settings.spark_vision_model} effort={effort})")


if __name__ == "__main__":
    main()
