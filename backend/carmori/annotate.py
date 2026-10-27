"""녹화 프레임 → 리플레이 클립 JSON.

Day 1~2에 찍은 실차 클립을 1fps JPEG로 뽑아 두고, 묶음마다 Spark에 '모든 항목'을
한 번만 물어 캐시한다. 이후 규칙 조정은 replay.py로 API 비용 없이 반복한다.

    ffmpeg -i clip.mp4 -vf fps=2 frames/%05d.jpg
    CARMORI_SPARK=meta python -m carmori.annotate frames/ --name cap_open_01 \
        --final-step OPEN_CAP --out ../fixtures/clips/recorded/cap_open_01.json

expect 값은 사람이 영상을 보고 정한 정답이다. 모델 응답에서 만들지 않는다.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from .config import Settings
from .models import CompletionSource, Step
from .spark import make_spark_client


async def annotate(
    frames_dir: Path, *, fps: float, window: int, stride: int
) -> list[dict]:
    spark = make_spark_client(Settings.from_env())
    paths = sorted(frames_dir.glob("*.jpg"))
    events: list[dict] = []
    seq = 0
    # 묶음끼리 프레임이 겹치지 않도록 stride >= window를 권장한다.
    for start in range(0, len(paths) - window + 1, stride):
        chunk = paths[start : start + window]
        answer = await spark.analyze([p.read_bytes() for p in chunk], step=None)
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


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("frames_dir", type=Path)
    parser.add_argument("--name", required=True)
    parser.add_argument("--description", default="")
    parser.add_argument("--fps", type=float, default=2.0)
    parser.add_argument("--window", type=int, default=2)
    parser.add_argument("--stride", type=int, default=2)
    parser.add_argument("--final-step", type=Step, required=True)
    parser.add_argument("--completion-source", type=CompletionSource, default=None)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)

    events = asyncio.run(annotate(args.frames_dir, fps=args.fps, window=args.window, stride=args.stride))
    clip = {
        "name": args.name,
        "description": args.description,
        "source": "recorded",
        "expect": {
            "final_step": args.final_step.value,
            "completion_source": args.completion_source.value if args.completion_source else None,
        },
        "events": events,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(clip, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {args.out} ({len(events)} windows)")


if __name__ == "__main__":
    main()
