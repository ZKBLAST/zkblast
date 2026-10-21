import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

// Candidate output only; this script cannot modify active manifests/web assets.
const root = path.resolve(import.meta.dirname, "..");
const name = process.argv[2];
if (!/^candidate-[\w-]+$/u.test(name ?? ""))
  throw new Error("EXPLICIT_CANDIDATE_REQUIRED");
const directory = path.join(root, "target/v2-mainnet", name);
const load = async (file) =>
  JSON.parse(await readFile(path.join(directory, file), "utf8"));
const candidate = await load("candidate.json");
const rehearsal = await load("mainnet-rehearsal.json");
const checks = await load("cryptographic-check.json");
if (
  candidate.environment !== "mainnet" ||
  rehearsal.chainId !== 4663 ||
  !rehearsal.v1ForkStateUnchanged ||
  !checks.currentSourceReproduced ||
  checks.results.length !== 2 ||
  !checks.results.every(
    (r) =>
      r.positiveProofVerified &&
      r.testnetVerificationKeyRejected &&
      r.alteredChainRejected &&
      r.alteredVaultRejected,
  )
)
  throw new Error("VERIFIED_MAINNET_CANDIDATE_REQUIRED");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const staged = path.join(directory, "public/zk/mainnet/v2");
await mkdir(staged, { recursive: true });
async function asset(sourceFile, filename, expected) {
  const bytes = await readFile(sourceFile);
  if (hash(bytes) !== expected) throw new Error("STAGED_ASSET_HASH_MISMATCH");
  await copyFile(sourceFile, path.join(staged, filename));
  return { path: `/zk/mainnet/v2/${filename}`, sha256: expected };
}
const bundles = {};
for (const kind of ["action", "fund"]) {
  const meta = candidate.artifacts[kind];
  bundles[kind] = {
    kind,
    publicInputs: meta.publicInputs,
    assets: {
      wasm: await asset(
        path.join(directory, `${kind}.wasm`),
        `${kind}.wasm`,
        meta.wasmSha256,
      ),
      zkey: await asset(
        path.join(directory, `${kind}-mainnet-candidate.zkey`),
        `${kind}.zkey`,
        meta.provingKeySha256,
      ),
      verificationKey: await asset(
        path.join(directory, `${kind}-vkey.json`),
        `${kind}-vkey.json`,
        meta.verificationKeySha256,
      ),
    },
  };
}
const previous = path.join(
  root,
  "target/v2-testnet/browser-stage-vUqQ3m/public/zk/testnet/v2",
);
const old = JSON.parse(
  await readFile(path.join(previous, "manifest.json"), "utf8"),
);
const noteCalculator = await asset(
  path.join(previous, "note.wasm"),
  "note.wasm",
  old.noteCalculator.sha256,
);
const bytes =
  JSON.stringify(
    {
      schemaVersion: 2,
      environment: "mainnet",
      chainId: "4663",
      settlement: rehearsal.predicted.PrivateVaultV2Proxy,
      treeVersion: "2",
      trustModel: "single-operator-mainnet-candidate",
      noteCalculator,
      ...bundles,
    },
    null,
    2,
  ) + "\n";
await writeFile(path.join(staged, "manifest.json"), bytes);
await writeFile(
  path.join(directory, "prover-staging.json"),
  JSON.stringify(
    {
      environment: "mainnet",
      chainId: 4663,
      activationAllowed: false,
      broadcastAllowed: false,
      deploymentVerified: false,
      predictedAddressesOnly: true,
      runtimeSchemaActivated: false,
      proverRelease: {
        manifestPath: "/zk/mainnet/v2/manifest.json",
        manifestSha256: hash(Buffer.from(bytes)),
      },
      explanation:
        "Local candidate only; not copied to web/public or active deployment manifest. Nonce/order changes require restaging and renewed simulation.",
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "Mainnet-only manifest and seven hash-checked assets staged locally; no runtime activation",
);
