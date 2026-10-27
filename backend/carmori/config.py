"""환경변수 설정. 값 목록은 루트 .env.example을 본다."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    spark_mode: str = "fake"  # fake | meta
    meta_api_base_url: str = ""
    meta_api_key: str = ""
    spark_vision_model: str = "TBD-spark-1.3"
    spark_audio_model: str = "TBD-spark-1.2"
    spark_timeout_s: float = 8.0
    cors_origins: tuple[str, ...] = ("http://localhost:5173", "https://localhost:5173")

    @classmethod
    def from_env(cls) -> Settings:
        origins = os.environ.get("CARMORI_CORS_ORIGINS")
        return cls(
            spark_mode=os.environ.get("CARMORI_SPARK", cls.spark_mode),
            meta_api_base_url=os.environ.get("META_API_BASE_URL", ""),
            meta_api_key=os.environ.get("META_API_KEY", ""),
            spark_vision_model=os.environ.get("SPARK_VISION_MODEL", cls.spark_vision_model),
            spark_audio_model=os.environ.get("SPARK_AUDIO_MODEL", cls.spark_audio_model),
            spark_timeout_s=float(os.environ.get("SPARK_TIMEOUT_S", cls.spark_timeout_s)),
            cors_origins=tuple(origins.split(",")) if origins else cls.cors_origins,
        )
