// 세션 안 음성 입출력. 반이중: TTS가 말하는 동안에는 듣지 않고, 끝나면 다시 듣는다.

import type { MicVAD } from "@ricky0123/vad-web";
import { encodeWav } from "./wav";

const RESUME_AFTER_TTS_MS = 300;

export class VoiceIO {
  private vad: MicVAD | null = null;
  private speaking = false;
  private speechDone: (() => void) | null = null;
  private listening = false;
  private peer: RTCPeerConnection | null = null;
  private peerStream: MediaStream | null = null;
  private realtimeReady = false;
  private pendingFallback: number | null = null;
  private lastTranscriptAt = 0;
  private speechStartedAt = 0;

  constructor(private readonly onUtterance: (wav: Blob) => void, private readonly onTranscript: (text: string) => void) {}

  /** iOS는 사용자 제스처 안에서 한 번 말해야 이후 TTS가 소리를 낸다. 시작 버튼에서 부른다. */
  unlockTts() {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    speechSynthesis.speak(u);
  }

  async startListening() {
    if (!this.vad) {
      const { MicVAD } = await import("@ricky0123/vad-web");
      this.vad = await MicVAD.new({
        model: "legacy",
        baseAssetPath: "/vad/",
        onnxWASMBasePath: "/vad/",
        ortConfig: (ort) => {
          // Vite cannot dynamically import a JS module from public/. Serve the ORT loader as a source asset.
          ort.env.wasm.wasmPaths = {
            mjs: new URL("../vendor/ort-wasm-simd-threaded.mjs", import.meta.url).href,
            wasm: new URL("/vad/ort-wasm-simd-threaded.wasm", window.location.origin).href,
          };
        },
        startOnLoad: false,
        onSpeechStart: () => { this.speechStartedAt = Date.now(); },
        onSpeechEnd: (audio) => {
          if (this.speaking) return;
          const wav = encodeWav(audio);
          if (!this.realtimeReady) { this.onUtterance(wav); return; }
          if (this.speechStartedAt > 0 && this.lastTranscriptAt >= this.speechStartedAt) return;
          if (this.pendingFallback !== null) window.clearTimeout(this.pendingFallback);
          this.pendingFallback = window.setTimeout(() => {
            this.pendingFallback = null;
            if (this.listening && !this.speaking) this.onUtterance(wav);
          }, 2500);
        },
      });
    }
    this.listening = true;
    if (!this.speaking) await this.vad.start();
    if (!this.peer) void this.connectRealtime();
  }

  private async connectRealtime() {
    let peer: RTCPeerConnection | null = null;
    let stream: MediaStream | null = null;
    try {
      const health = await fetch("/pipecat/openapi.json", { signal: AbortSignal.timeout(1500) });
      if (!health.ok || !this.listening) return;
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      peer = new RTCPeerConnection();
      const channel = peer.createDataChannel("carmori");
      channel.onopen = () => { this.realtimeReady = true; };
      channel.onclose = () => { this.realtimeReady = false; };
      peer.onconnectionstatechange = () => {
        if (peer?.connectionState === "failed" || peer?.connectionState === "closed") this.realtimeReady = false;
      };
      channel.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as { type?: string; text?: string };
          if (message.type === "carmori.transcript" && message.text?.trim() && this.listening && !this.speaking) {
            this.lastTranscriptAt = Date.now();
            if (this.pendingFallback !== null) window.clearTimeout(this.pendingFallback);
            this.pendingFallback = null;
            this.onTranscript(message.text.trim());
          }
        } catch { /* Ignore unrelated transport messages. */ }
      };
      stream.getAudioTracks().forEach((track) => peer!.addTrack(track, stream!));
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (peer.iceGatheringState !== "complete") await new Promise<void>((resolve) => {
        const timeout = window.setTimeout(resolve, 3000);
        peer!.addEventListener("icegatheringstatechange", () => {
          if (peer?.iceGatheringState === "complete") { window.clearTimeout(timeout); resolve(); }
        });
      });
      const response = await fetch("/pipecat/api/offer", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "offer", sdp: peer.localDescription?.sdp }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error("Pipecat offer failed");
      const answer = await response.json() as { sdp: string; type: RTCSdpType };
      await peer.setRemoteDescription({ sdp: answer.sdp, type: answer.type });
      if (!this.listening) throw new Error("Voice was stopped");
      this.peer = peer;
      this.peerStream = stream;
    } catch (error) {
      console.warn("Pipecat unavailable; using VAD with the batch transcriber", error);
      peer?.close();
      stream?.getTracks().forEach((track) => track.stop());
      this.realtimeReady = false;
    }
  }

  async stopListening() {
    this.listening = false;
    if (this.pendingFallback !== null) window.clearTimeout(this.pendingFallback);
    this.pendingFallback = null;
    await this.vad?.pause();
    this.realtimeReady = false;
    this.peer?.close();
    this.peer = null;
    this.peerStream?.getTracks().forEach((track) => track.stop());
    this.peerStream = null;
  }

  speak(text: string, lang = "en-US"): Promise<void> {
    return new Promise((resolve) => {
      this.speechDone?.();
      speechSynthesis.cancel();
      this.speaking = true;
      void this.vad?.pause();
      this.peerStream?.getAudioTracks().forEach((track) => { track.enabled = false; });

      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        if (this.speechDone === done) this.speechDone = null;
        this.speaking = false;
        setTimeout(() => {
          if (!this.speaking) {
            if (this.listening) void this.vad?.start();
            this.peerStream?.getAudioTracks().forEach((track) => { track.enabled = true; });
          }
          resolve();
        }, RESUME_AFTER_TTS_MS);
      };
      this.speechDone = done;
      u.onend = done;
      u.onerror = done;
      speechSynthesis.speak(u);
    });
  }

  cancelSpeech() {
    this.speechDone?.();
    speechSynthesis.cancel();
  }

  async destroy() {
    this.listening = false;
    this.cancelSpeech();
    if (this.pendingFallback !== null) window.clearTimeout(this.pendingFallback);
    this.pendingFallback = null;
    this.peer?.close();
    this.peerStream?.getTracks().forEach((track) => track.stop());
    this.peer = null;
    this.peerStream = null;
    this.realtimeReady = false;
    await this.vad?.destroy();
    this.vad = null;
  }
}
