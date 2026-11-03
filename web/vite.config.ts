import { readFileSync } from "node:fs";
import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// A phone needs a certificate it trusts for camera and microphone access.
// basicSsl is only a fallback for desktop development; its certificate is not trusted on iOS.
const useHttps = !process.env.CARMORI_HTTP;
const certificatePath = process.env.CARMORI_HTTPS_CERT;
const keyPath = process.env.CARMORI_HTTPS_KEY;
const localHttps = useHttps && certificatePath && keyPath
  ? { cert: readFileSync(certificatePath), key: readFileSync(keyPath) }
  : undefined;

export default defineConfig({
  plugins: [react(), ...(useHttps && !localHttps ? [basicSsl()] : [])],
  server: {
    ...(localHttps ? { https: localHttps } : {}),
    proxy: {
      "/api": {
        target: process.env.CARMORI_API ?? "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/pipecat": {
        target: process.env.CARMORI_PIPECAT ?? "http://127.0.0.1:7860",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/pipecat/, ""),
      },
    },
  },
  optimizeDeps: { include: ["@ricky0123/vad-web", "onnxruntime-web/wasm"] },
});
