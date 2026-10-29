// VAD 모델·worklet과 onnxruntime wasm을 public/vad/로 복사한다(CDN 의존 없이 서빙).
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "vad");
mkdirSync(out, { recursive: true });

const vadDist = join(root, "node_modules", "@ricky0123", "vad-web", "dist");
const ortDist = join(root, "node_modules", "onnxruntime-web", "dist");
const ortModuleOut = join(root, "src", "vendor");

const files = [
  [vadDist, "silero_vad_legacy.onnx"],
  [vadDist, "silero_vad_v5.onnx"],
  [vadDist, "vad.worklet.bundle.min.js"],
  ...readdirSync(ortDist)
    .filter((f) => /^ort-wasm-simd-threaded\.(wasm|mjs)$/.test(f))
    .map((f) => [ortDist, f]),
];

for (const [dir, name] of files) copyFileSync(join(dir, name), join(out, name));
mkdirSync(ortModuleOut, { recursive: true });
copyFileSync(join(ortDist, "ort-wasm-simd-threaded.mjs"), join(ortModuleOut, "ort-wasm-simd-threaded.mjs"));
console.log(`copied ${files.length} VAD assets to public/vad`);
