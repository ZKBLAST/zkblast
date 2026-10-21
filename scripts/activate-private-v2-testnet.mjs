import { readFile, copyFile, mkdir, writeFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Public artifacts only. Never copy a setup directory, witness, note, or transcript.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const name = process.argv[2];
if (!/^browser-stage-[\w-]+$/u.test(name ?? ""))
  throw new Error("EXPLICIT_STAGE_REQUIRED");
const stage = path.join(root, "packages/circuits/target/v2-testnet", name);
const report = JSON.parse(
  await readFile(
    path.join(root, "deployments/testnet/shielded-v2.json"),
    "utf8",
  ),
);
if (
  !report.complete ||
  report.chainId !== 46630 ||
  !report.runtimeAndInitializerVerified ||
  !report.legacySnapshotUnchanged ||
  report.transactions.length !== 14
)
  throw new Error("VERIFIED_DEPLOYMENT_REQUIRED");
const manifestPath = path.join(root, "deployments/testnet/manifest.json");
const original = await readFile(manifestPath);
const manifest = JSON.parse(original.toString());
const releaseBytes = await readFile(
  path.join(stage, "public", report.proverRelease.manifestPath),
);
const release = JSON.parse(releaseBytes.toString());
if (
  digest(releaseBytes) !== report.proverRelease.manifestSha256 ||
  release.settlement !== report.addresses.PrivateVaultV2Proxy ||
  release.treeVersion !== "2" ||
  release.chainId !== "46630" ||
  release.environment !== "testnet" ||
  manifest.chainId !== 46630 ||
  manifest.environment !== "testnet" ||
  manifest.shielded.vault.toLowerCase() === release.settlement.toLowerCase()
)
  throw new Error("RELEASE_BINDING_MISMATCH");
const assets = [
  release.noteCalculator,
  ...Object.values(release.action.assets),
  ...Object.values(release.fund.assets),
];
for (const asset of assets) {
  if (!/^\/zk\/testnet\/v2\/[\w.-]+$/u.test(asset.path))
    throw new Error("PUBLIC_ASSET_PATH_INVALID");
  if (
    digest(await readFile(path.join(stage, "public", asset.path))) !==
    asset.sha256
  )
    throw new Error("PUBLIC_ASSET_HASH_MISMATCH");
}
const destination = path.join(root, "apps/web/public/zk/testnet/v2");
await mkdir(destination, { recursive: true });
for (const asset of assets)
  await copyFile(
    path.join(stage, "public", asset.path),
    path.join(destination, path.basename(asset.path)),
  );
await writeFile(path.join(destination, "manifest.json"), releaseBytes);
const shieldedV2 = {
  vault: release.settlement,
  fieldHasher: report.addresses.Poseidon2FieldHasherV2,
  treeVersion: 2,
  deploymentBlock: Number(report.deploymentBlock),
  proverRelease: report.proverRelease,
};
if (
  manifest.shieldedV2 &&
  JSON.stringify(manifest.shieldedV2) !== JSON.stringify(shieldedV2)
)
  throw new Error("EXISTING_V2_CONFIG_DIFFERS");
manifest.shieldedV2 = shieldedV2;
const { shieldedV2: _v2, ...unchanged } = manifest;
const { shieldedV2: _oldV2, ...baseline } = JSON.parse(original.toString());
if (JSON.stringify(unchanged) !== JSON.stringify(baseline))
  throw new Error("V1_MANIFEST_CHANGED");
await writeFile(
  `${manifestPath}.tmp`,
  JSON.stringify(manifest, null, 2) + "\n",
);
await rename(`${manifestPath}.tmp`, manifestPath);
console.log(
  `Testnet v2 manifest and ${assets.length} verified public assets installed locally. V1 unchanged. No Railway deployment.`,
);
