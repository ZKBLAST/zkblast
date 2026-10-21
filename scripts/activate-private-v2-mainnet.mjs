import { readFile, copyFile, mkdir, writeFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Installs verified public prover assets and runtime config locally only.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const stage = path.join(root, "packages/circuits/target/v2-mainnet/candidate-s5KJOD");
const report = JSON.parse(await readFile(path.join(root, "deployments/mainnet/shielded-v2.json"), "utf8"));
if (!report.complete || report.chainId !== 4663 || !report.receiptReconciliation?.complete || report.transactions.length !== 27 || report.receiptReconciliation.canonicalReceipts !== 27)
  throw new Error("VERIFIED_MAINNET_DEPLOYMENT_REQUIRED");
const manifestPath = path.join(root, "deployments/mainnet/manifest.json");
const original = await readFile(manifestPath);
const manifest = JSON.parse(original.toString());
if (manifest.environment !== "mainnet" || manifest.chainId !== 4663 || manifest.shielded.vault.toLowerCase() === report.contracts.PrivateVaultV2Proxy.toLowerCase())
  throw new Error("MAINNET_V2_ISOLATION_REQUIRED");

const candidatePath = path.join(stage, "public/zk/mainnet/v2/manifest.json");
const candidate = JSON.parse(await readFile(candidatePath, "utf8"));
if (candidate.settlement.toLowerCase() !== report.contracts.PrivateVaultV2Proxy.toLowerCase() || candidate.chainId !== "4663" || candidate.environment !== "mainnet" || candidate.treeVersion !== "2")
  throw new Error("PROVER_DEPLOYMENT_BINDING_MISMATCH");
candidate.trustModel = "single-operator-mainnet";
const releaseBytes = Buffer.from(`${JSON.stringify(candidate, null, 2)}\n`);
const proverRelease = {
  manifestPath: "/zk/mainnet/v2/manifest.json",
  manifestSha256: digest(releaseBytes),
};
const assets = [candidate.noteCalculator, ...Object.values(candidate.action.assets), ...Object.values(candidate.fund.assets)];
for (const asset of assets) {
  if (!/^\/zk\/mainnet\/v2\/[\w.-]+$/u.test(asset.path)) throw new Error("PUBLIC_ASSET_PATH_INVALID");
  if (digest(await readFile(path.join(stage, "public", asset.path))) !== asset.sha256) throw new Error("PUBLIC_ASSET_HASH_MISMATCH");
}
const destination = path.join(root, "apps/web/public/zk/mainnet/v2");
await mkdir(destination, { recursive: true });
for (const asset of assets) await copyFile(path.join(stage, "public", asset.path), path.join(destination, path.basename(asset.path)));
await writeFile(path.join(destination, "manifest.json"), releaseBytes);

const pons = { address: "0x39dBED3a2bd333467115dE45665cC57F813C4571", symbol: "PONS", decimals: 18, enabled: true };
const shieldedV2 = {
  vault: report.contracts.PrivateVaultV2Proxy,
  fieldHasher: report.contracts.Poseidon2FieldHasherV2,
  treeVersion: 2,
  deploymentBlock: report.deploymentBlock,
  proverRelease,
  verifiedDeployment: report.verifiedDeployment,
  assets: [...report.assets.map((asset) => ({ ...asset, enabled: true })), pons],
};
if (manifest.shieldedV2 && JSON.stringify(manifest.shieldedV2) !== JSON.stringify(shieldedV2)) throw new Error("EXISTING_V2_CONFIG_DIFFERS");
manifest.shieldedV2 = shieldedV2;
const { shieldedV2: _next, ...unchanged } = manifest;
const { shieldedV2: _prior, ...baseline } = JSON.parse(original.toString());
if (JSON.stringify(unchanged) !== JSON.stringify(baseline)) throw new Error("V1_MANIFEST_CHANGED");
await writeFile(`${manifestPath}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`);
await rename(`${manifestPath}.tmp`, manifestPath);
console.log(JSON.stringify({ installedPublicAssets: assets.length, proverRelease, enabledAssets: [...report.assets.map((asset) => asset.symbol), "PONS"], pendingAssets: [], v1ManifestFieldsUnchanged: true, railwayDeployed: false }, null, 2));
