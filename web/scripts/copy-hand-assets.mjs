// MediaPipe WASM is served locally so live guidance does not depend on a CDN.
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const destination = join(root, "public", "mediapipe", "wasm");
mkdirSync(destination, { recursive: true });
for (const name of readdirSync(source)) {
  if (name.startsWith("vision_wasm_") && /\.(js|wasm)$/.test(name)) {
    copyFileSync(join(source, name), join(destination, name));
  }
}
