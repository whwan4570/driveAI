import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 휴대폰 카메라·마이크는 HTTPS에서만 열리므로 개발 서버도 HTTPS로 띄운다.
export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    proxy: {
      "/api": {
        target: process.env.CARMORI_API ?? "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  optimizeDeps: { exclude: ["onnxruntime-web"] },
});
