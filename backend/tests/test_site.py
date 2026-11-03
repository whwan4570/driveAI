from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from carmori.config import Settings
from carmori.main import create_app
from carmori.site import create_site
from carmori.spark import HappyPathSpark


def test_site_serves_the_web_app_and_the_api_under_one_origin(tmp_path):
    (tmp_path / "index.html").write_text("<!doctype html><title>Carmori</title>")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("console.log('ok')")
    client = TestClient(create_site(create_app(Settings(), spark=HappyPathSpark()), tmp_path))

    assert "Carmori" in client.get("/").text
    assert client.get("/?sample=status").status_code == 200
    assert client.get("/assets/app.js").text == "console.log('ok')"
    assert client.get("/api/health").status_code == 200
    missing = client.get("/api/vehicles/missing")
    assert missing.status_code == 404 and missing.json() == {"detail": "vehicle not found"}


def test_site_refuses_to_start_without_a_web_build(tmp_path):
    with pytest.raises(RuntimeError, match="pnpm build"):
        create_site(create_app(Settings(), spark=HappyPathSpark()), tmp_path)
