import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const packageRoot = path.resolve(import.meta.dirname, "..");
const target = path.join(packageRoot, "target/v1-withdraw");
const webAssetRoot = path.resolve(packageRoot, "../../apps/web/public/zk");

await mkdir(webAssetRoot, { recursive: true });
await Promise.all([
  copyFile(
    path.join(target, "withdraw_js/withdraw.wasm"),
    path.join(webAssetRoot, "withdraw.wasm"),
  ),
  copyFile(
    path.join(target, "withdraw_v1_final.zkey"),
    path.join(webAssetRoot, "withdraw-v1-final.zkey"),
  ),
  copyFile(
    path.join(target, "verification_key.json"),
    path.join(webAssetRoot, "withdraw-verification-key.json"),
  ),
  build({
    entryPoints: [path.join(packageRoot, "browser/withdraw-worker.js")],
    outfile: path.join(webAssetRoot, "withdraw-worker.js"),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    minify: true,
  }),
]);
console.log("Browser withdraw prover assets prepared");
