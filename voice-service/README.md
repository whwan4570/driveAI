# Carmori Pipecat voice service

This separate Python 3.12 process transcribes browser microphone audio with Pipecat 1.14 and MetaSTTService. The browser's VAD remains the fallback if the service or its Meta session is unavailable. The Carmori API handles commands, grounded questions, and maintenance records; the service only returns final transcripts.

## Run locally

Create a Python 3.12 virtual environment and install this folder (`pip install -e .`). Set `META_API_KEY` in the process environment without putting it in frontend code. Start with `python bot.py -t webrtc --host 127.0.0.1 --port 7860`. Run the existing FastAPI app on port 8000 and Vite on port 5173. Vite proxies `/pipecat` to port 7860; override with `CARMORI_PIPECAT` if needed.

Open the app and enable voice once. It uses the existing ricky0123/vad for utterance boundaries and a delayed batch fallback. When WebRTC connects, Pipecat forwards Meta's final transcript through its data channel; the current screen routes it to pause/resume or a question. On screen speech synthesis, the WebRTC microphone track is muted to avoid feedback.

The Pipecat runner's `/api/offer` is intended for this local prototype. Production needs authenticated session offers and a WebRTC deployment with reachable ICE candidates/TURN. Browser TTS still uses half-duplex playback, so speaking over Carmori's own voice is not yet a verified interruption path. A `META_API_KEY` with access to Muse Voice realtime is required to validate live transcription.
