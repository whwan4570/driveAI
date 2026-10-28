"""Slow visual answers may not override a newer voice command."""

import asyncio
import base64
from datetime import datetime, timezone

import httpx

from carmori.config import Settings
from carmori.main import create_app
from carmori.models import CapState, SceneAnswer, Tri


class DelayedVision:
    model_version = "delayed-test"

    def __init__(self):
        self.started = asyncio.Event()
        self.release = asyncio.Event()

    async def analyze(self, frames, step, reference=None):
        self.started.set()
        await self.release.wait()
        return SceneAnswer(inlet_visible=Tri.YES, inlet_symbol_ok=Tri.YES, cap_state=CapState.CLOSED)


def test_pause_and_resume_supersede_an_in_flight_visual_answer():
    async def run():
        spark = DelayedVision()
        app = create_app(Settings(), spark=spark)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            vehicle = (await client.post("/vehicles", json={"spec_id": "demo", "year": 2021})).json()
            session = (await client.post("/sessions", json={"vehicle_id": vehicle["vehicle_id"]})).json()["session"]
            session_id = session["session_id"]
            frame = {"frame_id": "frame-1", "captured_at": datetime.now(timezone.utc).isoformat(), "jpeg_base64": base64.b64encode(b"jpeg").decode()}
            request = asyncio.create_task(client.post(f"/sessions/{session_id}/observations", json={"windows": [{"sequence_id": 1, "frames": [frame]}]}))
            await asyncio.wait_for(spark.started.wait(), timeout=2)
            await client.post(f"/sessions/{session_id}/voice", json={"intent": "PAUSE"})
            await client.post(f"/sessions/{session_id}/voice", json={"intent": "RESUME"})
            spark.release.set()
            response = await asyncio.wait_for(request, timeout=2)
            assert response.json()["transition_reason"] == "superseded"
            assert response.json()["windows"][0]["accepted"] is False
            assert (await client.get(f"/sessions/{session_id}")).json()["step"] == "FIND_INLET"

    asyncio.run(run())


def test_frames_captured_before_a_voice_command_are_rejected_on_arrival():
    async def run():
        spark = DelayedVision()
        app = create_app(Settings(), spark=spark)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            vehicle = (await client.post("/vehicles", json={"spec_id": "demo", "year": 2021})).json()
            session = (await client.post("/sessions", json={"vehicle_id": vehicle["vehicle_id"]})).json()["session"]
            session_id = session["session_id"]
            await client.post(f"/sessions/{session_id}/voice", json={"intent": "PAUSE"})
            await client.post(f"/sessions/{session_id}/voice", json={"intent": "RESUME"})
            frame = {"frame_id": "old-frame", "captured_at": datetime.now(timezone.utc).isoformat(), "jpeg_base64": base64.b64encode(b"jpeg").decode()}
            result = await asyncio.wait_for(client.post(
                f"/sessions/{session_id}/observations",
                json={"expected_state_version": session["state_version"],
                      "windows": [{"sequence_id": 1, "frames": [frame]}]},
            ), timeout=2)
            assert result.json()["transition_reason"] == "superseded"
            assert not spark.started.is_set()

    asyncio.run(run())
