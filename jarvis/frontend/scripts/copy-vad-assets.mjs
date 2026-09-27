// Copies the Silero VAD model, its AudioWorklet and the onnxruntime WASM files into public/vad/
// so voice activity detection runs fully in the browser — no audio leaves the device until speech ends.
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "vad");
mkdirSync(out, { recursive: true });
const vad = join(root, "node_modules", "@ricky0123", "vad-web", "dist");
const ort = join(root, "node_modules", "onnxruntime-web", "dist");
for (const f of readdirSync(vad)) {
  if (f === "silero_vad_v5.onnx" || f === "vad.worklet.bundle.min.js") copyFileSync(join(vad, f), join(out, f));
}
for (const f of readdirSync(ort)) {
  if (/^ort-wasm-simd-threaded\.(wasm|mjs)$/.test(f)) {
    copyFileSync(join(ort, f), join(out, f));
  }
}
console.log("vad assets ->", out);
