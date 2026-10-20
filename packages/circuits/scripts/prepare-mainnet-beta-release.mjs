import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
const target = path.join(
  root,
  "packages/circuits/target/mainnet-beta-withdraw-v1",
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const report = JSON.parse(
  await readFile(path.join(target, "setup-report.json"), "utf8"),
);
if (
  report.chainId !== 4663 ||
  report.environment !== "mainnet" ||
  report.trustModel !== "experimental-single-operator" ||
  report.independentReview !== false ||
  report.verification?.localMainnetContextProof !== true ||
  report.verification?.keyVerified !== true
)
  throw new Error("VERIFIED_EXPERIMENTAL_SETUP_REQUIRED");
const testnet = JSON.parse(
  await readFile(
    path.join(
      root,
      "packages/circuits/architecture/withdraw-v1-artifacts.json",
    ),
    "utf8",
  ),
);
if (
  report.artifacts["withdraw_final.zkey"] === testnet.ceremony.provingKeySha256
)
  throw new Error("TESTNET_KEY_REUSE_REJECTED");
for (const [name, expected] of Object.entries(report.artifacts)) {
  if (
    !/^[A-Za-z0-9_.-]+$/u.test(name) ||
    hash(await readFile(path.join(target, name))) !== expected
  )
    throw new Error("SETUP_ARTIFACT_INTEGRITY_FAILED");
}
async function immutableWrite(destination, bytes) {
  try {
    await writeFile(destination, bytes, { flag: "wx" });
  } catch (error) {
    if (
      error.code !== "EEXIST" ||
      hash(await readFile(destination)) !== hash(bytes)
    )
      throw error;
  }
}
const keyId = report.artifacts["withdraw_final.zkey"].slice(0, 12);
const publicRoot = path.join(root, "apps/web/public/zk/mainnet");
await mkdir(publicRoot, { recursive: true });
const assets = {};
for (const [kind, source, extension] of [
  ["wasm", "withdraw.wasm", "wasm"],
  ["zkey", "withdraw_final.zkey", "zkey"],
  ["verificationKey", "verification_key.json", "vkey.json"],
]) {
  const name = `withdraw-v1-beta-${keyId}.${extension}`;
  const bytes = await readFile(path.join(target, source));
  await immutableWrite(path.join(publicRoot, name), bytes);
  assets[kind] = { path: `/zk/mainnet/${name}`, sha256: hash(bytes) };
}
const manifest = Buffer.from(
  `${JSON.stringify(
    {
      schemaVersion: 1,
      environment: "mainnet",
      chainId: 4663,
      circuitVersion: 1,
      publicInputs: 13,
      trustModel: "experimental-single-operator",
      assets,
    },
    null,
    2,
  )}\n`,
);
const manifestName = `withdraw-v1-beta-${keyId}.json`;
await immutableWrite(path.join(publicRoot, manifestName), manifest);
const rawVerifier = await readFile(
  path.join(target, "WithdrawGroth16Verifier.sol"),
  "utf8",
);
if ((rawVerifier.match(/contract Groth16Verifier\b/gu) ?? []).length !== 1)
  throw new Error("UNEXPECTED_GENERATED_VERIFIER_NAME");
const verifier = Buffer.from(
  rawVerifier.replace(
    /contract Groth16Verifier\b/u,
    "contract ZKBlastBetaGroth16Verifier",
  ),
);
const verifierRoot = path.join(
  root,
  "packages/contracts/src/privacy/mainnet-beta",
);
await mkdir(verifierRoot, { recursive: true });
await immutableWrite(
  path.join(verifierRoot, "ZKBlastBetaGroth16Verifier.sol"),
  verifier,
);
const release = {
  schemaVersion: 1,
  environment: "mainnet",
  chainId: 4663,
  launchMode: "experimental-single-operator",
  independentReview: false,
  proverRelease: {
    manifestPath: `/zk/mainnet/${manifestName}`,
    manifestSha256: hash(manifest),
  },
  setupReportSha256: hash(
    await readFile(path.join(target, "setup-report.json")),
  ),
  artifacts: report.artifacts,
  compiledVerifierSourceSha256: hash(verifier),
  status: "local-candidate-not-deployed",
  broadcasts: 0,
};
await immutableWrite(
  path.join(root, "deployments/mainnet/shielded-beta-release.json"),
  Buffer.from(`${JSON.stringify(release, null, 2)}\n`),
);
console.log(
  JSON.stringify({
    prepared: true,
    keyId,
    proverRelease: release.proverRelease,
    trustModel: release.launchMode,
    independentReview: false,
    broadcasts: 0,
  }),
);
