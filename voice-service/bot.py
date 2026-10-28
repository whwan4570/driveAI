"""Meta realtime transcription over Pipecat SmallWebRTC.

Run separately from the Python 3.10 Carmori API:
    python bot.py --host 127.0.0.1 --port 7860
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

from pipecat.frames.frames import OutputTransportMessageFrame, TranscriptionFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineWorker
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.runner.types import RunnerArguments
from pipecat.services.meta.stt import MetaSTTService
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport
from pipecat.workers.runner import WorkerRunner


class TranscriptToBrowser(FrameProcessor):
    """Only final transcripts are forwarded; partials must not trigger commands."""

    async def process_frame(self, frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, TranscriptionFrame) and frame.text.strip():
            await self.push_frame(OutputTransportMessageFrame(message={
                "type": "carmori.transcript",
                "text": frame.text.strip(),
            }))
        else:
            await self.push_frame(frame, direction)


async def bot(runner_args: RunnerArguments):
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    key = os.environ.get("META_API_KEY")
    if not key:
        raise RuntimeError("META_API_KEY is required for Pipecat Meta STT")

    transport = SmallWebRTCTransport(
        webrtc_connection=runner_args.webrtc_connection,
        params=TransportParams(audio_in_enabled=True, audio_out_enabled=False),
    )
    stt = MetaSTTService(api_key=key, settings=MetaSTTService.Settings(mode="ENDPOINTING"))
    pipeline = Pipeline([transport.input(), stt, TranscriptToBrowser(), transport.output()])
    worker = PipelineWorker(pipeline)
    runner = WorkerRunner(handle_sigint=runner_args.handle_sigint)
    await runner.add_workers(worker)

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(_transport, _client):
        await runner.cancel()

    await runner.run()


if __name__ == "__main__":
    from pipecat.runner.run import main

    main()
