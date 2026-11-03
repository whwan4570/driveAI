"""한 프로세스 배포: API는 /api 아래, 빌드한 웹(web/dist)은 / 에서 내보낸다.

로컬 개발은 그대로 carmori.main:app + Vite 프록시(/api 제거)를 쓴다. 배포에서는
같은 주소로 웹과 API를 내보내므로 CORS나 별도 프록시가 필요 없다.

    uvicorn carmori.site:create_site --factory --host 0.0.0.0 --port $PORT

웹 빌드 위치는 CARMORI_WEB_DIST(기본: 저장소의 web/dist)로 바꿀 수 있다.
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .main import create_app

REPO_WEB_DIST = Path(__file__).resolve().parents[2] / "web" / "dist"


def create_site(api: FastAPI | None = None, web_dist: Path | None = None) -> FastAPI:
    web_dist = web_dist or Path(os.environ.get("CARMORI_WEB_DIST") or REPO_WEB_DIST)
    if not (web_dist / "index.html").is_file():
        raise RuntimeError(f"web build not found at {web_dist}; run `pnpm build` in web/ first")
    site = FastAPI(title="Carmori site", docs_url=None, redoc_url=None, openapi_url=None)
    # create_app에는 lifespan 훅이 없어서 하위 앱으로 붙여도 시작 처리가 빠지지 않는다.
    site.mount("/api", api or create_app())
    site.mount("/", StaticFiles(directory=web_dist, html=True), name="web")
    return site
