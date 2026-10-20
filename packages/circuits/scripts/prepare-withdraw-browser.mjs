import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { build } from "esbuild";

const packageRoot = path.resolve(import.meta.dirname, "..");
const target = path.join(packageRoot, "target/v1-withdraw");
const webAssetRoot = path.resolve(packageRoot, "../../apps/web/public/zk");
const networkRoot = path.join(webAssetRoot, "testnet");

await mkdir(webAssetRoot, { recursive: true });
await mkdir(networkRoot, { recursive: true });
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
]);
const artifacts = JSON.parse(
  await readFile(
    path.join(packageRoot, "architecture/withdraw-v1-artifacts.json"),
    "utf8",
  ),
);
const files = {
  wasm: ["withdraw.wasm", artifacts.reproducibleBuild.wasmSha256],
  zkey: ["withdraw-v1-final.zkey", artifacts.ceremony.provingKeySha256],
  verificationKey: [
    "withdraw-verification-key.json",
    artifacts.ceremony.verificationKeySha256,
  ],
};
const assets = {};
for (const [kind, [name, expected]] of Object.entries(files)) {
  const bytes = await readFile(path.join(webAssetRoot, name));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== expected)
    throw new Error(`TESTNET_ARTIFACT_HASH_MISMATCH: ${kind}`);
  await copyFile(path.join(webAssetRoot, name), path.join(networkRoot, name));
  assets[kind] = { path: `/zk/testnet/${name}`, sha256 };
}
const manifest = `${JSON.stringify(
  {
    schemaVersion: 1,
    environment: "testnet",
    chainId: 46630,
    circuitVersion: 1,
    publicInputs: 13,
    trustModel: "testnet-only",
    assets,
  },
  null,
  2,
)}\n`;
await writeFile(path.join(networkRoot, "withdraw-manifest.json"), manifest);
await writeFile(
  path.resolve(
    packageRoot,
    "../../apps/web/src/data/testnet-prover-release.json",
  ),
  `${JSON.stringify(
    {
      manifestPath: "/zk/testnet/withdraw-manifest.json",
      manifestSha256: createHash("sha256").update(manifest).digest("hex"),
    },
    null,
    2,
  )}\n`,
);
await copyFile(
  path.resolve(
    packageRoot,
    "../../apps/web/src/data/testnet-prover-release.json",
  ),
  path.join(packageRoot, "browser/testnet-prover-release.json"),
);
await build({
  entryPoints: [path.join(packageRoot, "browser/withdraw-worker.js")],
  outfile: path.join(webAssetRoot, "withdraw-worker.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
});
console.log(
  "Testnet prover isolated and hash-pinned; no mainnet artifacts created",
);
