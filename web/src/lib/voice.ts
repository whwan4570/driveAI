// 세션 안 음성 입출력. 반이중: TTS가 말하는 동안에는 듣지 않고, 끝나면 다시 듣는다.

import type { MicVAD } from "@ricky0123/vad-web";
import { encodeWav } from "./wav";

const RESUME_AFTER_TTS_MS = 300;

export class VoiceIO {
  private vad: MicVAD | null = null;
  private speaking = false;
  private listening = false;

  constructor(private readonly onUtterance: (wav: Blob) => void) {}

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
        startOnLoad: false,
        onSpeechEnd: (audio) => {
          if (!this.speaking) this.onUtterance(encodeWav(audio));
        },
      });
    }
    this.listening = true;
    if (!this.speaking) await this.vad.start();
  }

  async stopListening() {
    this.listening = false;
    await this.vad?.pause();
  }

  speak(text: string, lang = "en-US"): Promise<void> {
    return new Promise((resolve) => {
      speechSynthesis.cancel();
      this.speaking = true;
      void this.vad?.pause();

      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      const done = () => {
        this.speaking = false;
        setTimeout(() => {
          if (this.listening && !this.speaking) void this.vad?.start();
          resolve();
        }, RESUME_AFTER_TTS_MS);
      };
      u.onend = done;
      u.onerror = done;
      speechSynthesis.speak(u);
    });
  }

  cancelSpeech() {
    speechSynthesis.cancel();
  }

  async destroy() {
    speechSynthesis.cancel();
    await this.vad?.destroy();
    this.vad = null;
  }
}
