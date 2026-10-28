"""환경변수 설정. 값 목록은 루트 .env.example을 본다."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    spark_mode: str = "fake"  # fake | meta
    meta_api_base_url: str = ""
    meta_api_key: str = ""
    spark_vision_model: str = "muse-spark-1.3"
    spark_audio_model: str = "TBD-spark-1.2"
    spark_timeout_s: float = 20.0
    # 단계 관찰은 짧은 시각 판단이라 추론을 최소로 둔다. 빈 값이면 모델 기본값.
    spark_reasoning_effort: str = "minimal"
    cors_origins: tuple[str, ...] = ("http://localhost:5173", "https://localhost:5173")
    db_path: str | None = None

    @classmethod
    def from_env(cls) -> Settings:
        origins = os.environ.get("CARMORI_CORS_ORIGINS")
        return cls(
            spark_mode=os.environ.get("CARMORI_SPARK", "meta" if os.environ.get("META_API_KEY") else "fake"),
            meta_api_base_url=os.environ.get("META_API_BASE_URL", ""),
            meta_api_key=os.environ.get("META_API_KEY", ""),
            spark_vision_model=os.environ.get("SPARK_VISION_MODEL") or cls.spark_vision_model,
            spark_audio_model=os.environ.get("SPARK_AUDIO_MODEL", cls.spark_audio_model),
            spark_timeout_s=float(os.environ.get("SPARK_TIMEOUT_S", cls.spark_timeout_s)),
            spark_reasoning_effort=os.environ.get("SPARK_REASONING_EFFORT", cls.spark_reasoning_effort),
            cors_origins=tuple(origins.split(",")) if origins else cls.cors_origins,
            db_path=os.environ.get("CARMORI_DB_PATH") or str(Path(__file__).resolve().parent.parent / "data" / "carmori.sqlite"),
        )
