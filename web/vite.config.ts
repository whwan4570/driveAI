import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 휴대폰 카메라·마이크는 HTTPS에서만 열리므로 개발 서버도 HTTPS로 띄운다.
// 데스크톱 미리보기(localhost)는 HTTP도 보안 컨텍스트라 CARMORI_HTTP=1로 끌 수 있다.
const useHttps = !process.env.CARMORI_HTTP;

export default defineConfig({
  plugins: [react(), ...(useHttps ? [basicSsl()] : [])],
  server: {
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
