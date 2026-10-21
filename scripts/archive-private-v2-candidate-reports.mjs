import { readFile, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

// Preserve prior public evidence before a nonce-bound simulation refresh; no keys copied.
const name = process.argv[2];
if (!/^candidate-[\w-]+$/u.test(name ?? ""))
  throw new Error("EXPLICIT_CANDIDATE_REQUIRED");
const root = path.resolve(import.meta.dirname, "..");
const directory = path.join(root, "packages/circuits/target/v2-mainnet", name);
const prior = JSON.parse(
  await readFile(path.join(directory, "mainnet-rehearsal.json"), "utf8"),
);
const output = path.join(
  directory,
  "report-history",
  `nonce-${prior.observedPendingNonce}-${new Date().toISOString().replace(/[:.]/gu, "-")}`,
);
await mkdir(output, { recursive: true });
for (const file of [
  "mainnet-rehearsal.json",
  "mainnet-proposal.json",
  "cryptographic-check.json",
  "prover-staging.json",
  "public/zk/mainnet/v2/manifest.json",
])
  await copyFile(
    path.join(directory, file),
    path.join(output, path.basename(file)),
  );
console.log(
  `Prior nonce ${prior.observedPendingNonce} reports archived; proving keys unchanged.`,
);
