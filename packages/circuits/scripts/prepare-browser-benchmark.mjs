import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const packageRoot = path.resolve(import.meta.dirname, "..");
const outputRoot = path.join(packageRoot, "target/browser-benchmark");
await rm(outputRoot, { recursive: true, force: true });
await mkdir(path.join(outputRoot, "assets"), { recursive: true });
await Promise.all([
  cp(
    path.join(packageRoot, "browser/index.html"),
    path.join(outputRoot, "index.html"),
  ),
  cp(
    path.join(packageRoot, "target/circom/input.json"),
    path.join(outputRoot, "assets/input.json"),
  ),
  cp(
    path.join(packageRoot, "target/circom/benchmark_js/benchmark.wasm"),
    path.join(outputRoot, "assets/benchmark.wasm"),
  ),
  cp(
    path.join(packageRoot, "target/circom/circuit-final.zkey"),
    path.join(outputRoot, "assets/circuit-final.zkey"),
  ),
  cp(
    path.join(packageRoot, "target/circom/verification-key.json"),
    path.join(outputRoot, "assets/verification-key.json"),
  ),
  build({
    entryPoints: [path.join(packageRoot, "browser/worker.js")],
    outfile: path.join(outputRoot, "worker.bundle.js"),
    bundle: true,
    conditions: ["browser"],
    format: "esm",
    platform: "browser",
    sourcemap: false,
  }),
]);
console.log(outputRoot);
