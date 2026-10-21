import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import * as snarkjs from "snarkjs";
import { createActionFixtureBuilder } from "../test/helpers/v2-fixtures.mjs";

// Cryptographic fixtures only, never live deposits/notes or browser acceptance.
const root = path.resolve(import.meta.dirname, "..");
const name = process.argv[2];
if (!/^candidate-[\w-]+$/u.test(name ?? ""))
  throw new Error("EXPLICIT_CANDIDATE_REQUIRED");
const directory = path.join(root, "target/v2-mainnet", name);
const candidate = JSON.parse(
  await readFile(path.join(directory, "candidate.json"), "utf8"),
);
const rehearsal = JSON.parse(
  await readFile(path.join(directory, "mainnet-rehearsal.json"), "utf8"),
);
if (
  candidate.environment !== "mainnet" ||
  rehearsal.chainId !== 4663 ||
  !rehearsal.deploymentVerifiedOnForkOnly
)
  throw new Error("MAINNET_REHEARSAL_REQUIRED");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
if (
  hash(await readFile(path.join(directory, "candidate.json"))) !==
  rehearsal.candidateSha256
)
  throw new Error("CANDIDATE_CHANGED_AFTER_REHEARSAL");
for (const kind of ["action", "fund"]) {
  const meta = candidate.artifacts[kind];
  const files = [
    [`${kind}.wasm`, meta.wasmSha256],
    [`${kind}-mainnet-candidate.zkey`, meta.provingKeySha256],
    [`${kind}-vkey.json`, meta.verificationKeySha256],
    [
      `verifiers/${kind === "action" ? "Action" : "Fund"}Groth16MainnetV2.sol`,
      meta.solidityVerifierSha256,
    ],
  ];
  for (const [filename, expected] of files)
    if (hash(await readFile(path.join(directory, filename))) !== expected)
      throw new Error("MAINNET_CANDIDATE_HASH_MISMATCH");
}
const source = path.join(root, "target/v2-testnet/run-4joRG7");
const fresh = path.join(directory, "source-check");
await mkdir(fresh, { recursive: true });
for (const kind of ["action", "fund"]) {
  await promisify(execFile)(
    path.join(root, "node_modules/.bin/circom2"),
    [
      path.join(root, `src/v2/${kind}.circom`),
      "--O2",
      "--r1cs",
      "--wasm",
      "-o",
      fresh,
    ],
    { maxBuffer: 2 * 1024 * 1024 },
  );
  if (
    hash(await readFile(path.join(fresh, `${kind}.r1cs`))) !==
      candidate.artifacts[kind].r1csSha256 ||
    hash(await readFile(path.join(fresh, `${kind}_js/${kind}.wasm`))) !==
      candidate.artifacts[kind].wasmSha256
  )
    throw new Error("CURRENT_CIRCUIT_SOURCE_MISMATCH");
}
const require = createRequire(import.meta.url);
async function calculator(kind) {
  const folder = path.join(source, `${kind}_js`);
  return require(path.join(folder, "witness_calculator.js"))(
    await readFile(path.join(folder, `${kind}.wasm`)),
  );
}
const builder = createActionFixtureBuilder(
  await calculator("spend-vector"),
  await calculator("merkle-test"),
);
const asset = rehearsal.assets.find((a) => a.symbol === "USDG");
const second = rehearsal.assets.find((a) => a.symbol === "WETH");
const pair = [asset, second].sort((a, b) =>
  BigInt(a.address) < BigInt(b.address) ? -1 : 1,
);
const market = JSON.parse(
  await readFile(
    path.join(root, "../../deployments/mainnet/market.json"),
    "utf8",
  ),
);
const context = {
  ...builder.context,
  chain_id: "4663",
  settlement: String(BigInt(rehearsal.predicted.PrivateVaultV2Proxy)),
  asset0: String(BigInt(pair[0].address)),
  asset1: String(BigInt(pair[1].address)),
  pool: String(BigInt(market.pool.address)),
  tree_version: "2",
};
const note = await builder.note(
  pair.findIndex((a) => a.symbol === "USDG"),
  1,
  101,
  201,
  context,
);
const fund = {
  schema_version: "2",
  operation: "0",
  chain_id: context.chain_id,
  settlement: context.settlement,
  tree_version: "2",
  merkle_root: "0",
  nullifier: "0",
  asset: String(BigInt(asset.address)),
  amount: "1",
  recipient: "0",
  commitment: note.commitment,
  secret: "101",
  nonce: "201",
  leaf_index: "0",
  path_siblings: Array(32).fill("1"),
  path_directions: Array(32).fill("0"),
};
const action = await builder.vector(
  [10, 0, 0],
  [0, 9, 0],
  [0, 9, 0],
  [10, 0, 0],
  [0, 0, 0],
  context,
);
let curve;
const results = [];
try {
  curve = await snarkjs.curves.getCurveFromName("bn128");
  for (const kind of ["fund", "action"]) {
    const vkey = JSON.parse(
      await readFile(path.join(directory, `${kind}-vkey.json`), "utf8"),
    );
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      kind === "fund" ? fund : action,
      path.join(directory, `${kind}.wasm`),
      path.join(directory, `${kind}-mainnet-candidate.zkey`),
    );
    if (!(await snarkjs.groth16.verify(vkey, publicSignals, proof)))
      throw new Error("MAINNET_PROOF_REJECTED");
    for (const index of kind === "fund" ? [2, 3] : [1, 2]) {
      const altered = [...publicSignals];
      altered[index] = String(BigInt(altered[index]) + 1n);
      if (await snarkjs.groth16.verify(vkey, altered, proof))
        throw new Error("ALTERED_CONTEXT_ACCEPTED");
    }
    const testnetVkey = JSON.parse(
      await readFile(path.join(source, `${kind}-vkey.json`), "utf8"),
    );
    if (await snarkjs.groth16.verify(testnetVkey, publicSignals, proof))
      throw new Error("TESTNET_KEY_NOT_ISOLATED");
    results.push({
      kind,
      positiveProofVerified: true,
      alteredChainRejected: true,
      alteredVaultRejected: true,
      testnetVerificationKeyRejected: true,
      publicInputs: publicSignals.length,
    });
    console.log(
      `${kind}: mainnet-context proof verified; wrong chain/vault and testnet key rejected`,
    );
  }
  await writeFile(
    path.join(directory, "cryptographic-check.json"),
    JSON.stringify(
      {
        environment: "mainnet",
        chainId: 4663,
        syntheticOnly: true,
        liveNotesCreated: false,
        liveTransactionsBroadcast: 0,
        currentSourceReproduced: true,
        setupKeysRegenerated: false,
        results,
        actualBrowserAcceptance: false,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await curve?.terminate();
}
