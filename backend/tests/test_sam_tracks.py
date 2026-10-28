import asyncio

import httpx

from carmori.config import Settings
from carmori.main import create_app
from carmori.sam_video import SamDetection, SamVideoResult


class FakeTracker:
    async def segment(self, video: bytes, target: str) -> SamVideoResult:
        assert video[4:8] == b"ftyp"
        return SamVideoResult(target=target, detections=[SamDetection(
            frame_index=3, track_id="0", box=(10, 20, 30, 40), confidence=0.8,
            mask_encoding="one_bit", mask_payload="abc", mask_width=20, mask_height=20,
        )])


def test_sam_track_endpoint_keeps_masks_separate_from_step_completion():
    async def run():
        app = create_app(Settings(), sam_tracker=FakeTracker())
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            vehicle = (await client.post("/vehicles", json={"spec_id": "demo", "year": 2021})).json()
            session = (await client.post("/sessions", json={"vehicle_id": vehicle["vehicle_id"]})).json()["session"]
            session_id = session["session_id"]
            bad = await client.post(f"/sessions/{session_id}/tracks?target=cap", content=b"not an MP4", headers={"content-type": "video/mp4"})
            assert bad.status_code == 422
            clip = b"\0\0\0\x20ftyp" + bytes(32)
            result = await client.post(f"/sessions/{session_id}/tracks?target=cap", content=clip, headers={"content-type": "video/mp4"})
            assert result.status_code == 200
            assert result.json()["track_scope"] == "request"
            assert result.json()["detections"][0]["track_id"] == "0"
            assert (await client.get(f"/sessions/{session_id}")).json()["step"] == "FIND_INLET"

    asyncio.run(run())
