import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import * as snarkjs from "snarkjs";
import { provePrivateV2 } from "../browser/private-v2-prover.mjs";

// Existing synthetic setup only; never changes a key or sends an RPC transaction.
test("v2 browser-prover protocol produces and locally verifies a real funding proof", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const { run } = JSON.parse(
    await readFile(path.join(root, "target/v2-testnet/last-run.json"), "utf8"),
  );
  assert.match(run, /^run-[A-Za-z0-9_-]+$/u);
  const directory = path.join(root, "target/v2-testnet", run);
  const release = JSON.parse(
    await readFile(path.join(directory, "release.local.json"), "utf8"),
  );
  assert.equal(release.eligibleForDeployment, false);
  const vector = JSON.parse(
    await readFile(path.join(directory, "local-proofs/deposit0.json"), "utf8"),
  );
  const files = new Map([
    [
      "/zk/testnet/v2/fund.wasm",
      await readFile(path.join(directory, "fund_js/fund.wasm")),
    ],
    [
      "/zk/testnet/v2/fund.zkey",
      await readFile(path.join(directory, "fund-testnet.zkey")),
    ],
    [
      "/zk/testnet/v2/fund.json",
      await readFile(path.join(directory, "fund-vkey.json")),
    ],
  ]);
  const digest = (bytes) =>
    createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
  const asset = (name) => ({
    path: `/zk/testnet/v2/${name}`,
    sha256: digest(files.get(`/zk/testnet/v2/${name}`)),
  });
  assert.equal(asset("fund.wasm").sha256, release.artifacts.fund.wasmSha256);
  assert.equal(
    asset("fund.zkey").sha256,
    release.artifacts.fund.provingKeySha256,
  );
  assert.equal(
    asset("fund.json").sha256,
    release.artifacts.fund.verificationKeySha256,
  );
  const scope = {
    environment: "testnet",
    chainId: "46630",
    settlement: "0x0000000000000000000000000000000000004000",
    treeVersion: "2",
  };
  const input = {
    schema_version: "2",
    operation: "0",
    chain_id: "46630",
    settlement: "16384",
    tree_version: "2",
    merkle_root: "0",
    nullifier: "0",
    asset: "4096",
    amount: "1000000",
    recipient: "0",
    commitment: vector.publicSignals[10],
    secret: "101",
    nonce: "201",
    leaf_index: "0",
    path_siblings: Array(32).fill("0"),
    path_directions: Array(32).fill("0"),
  };
  let curve;
  try {
    const result = await provePrivateV2(
      {
        kind: "fund",
        scope,
        input,
        expectedPublicInputs: vector.publicSignals,
        manifest: {
          ...scope,
          schemaVersion: 2,
          kind: "fund",
          publicInputs: 11,
          assets: {
            wasm: asset("fund.wasm"),
            zkey: asset("fund.zkey"),
            verificationKey: asset("fund.json"),
          },
        },
      },
      {
        groth16: snarkjs.groth16,
        sha256: async (bytes) => digest(bytes),
        fetchAsset: async (filename) => {
          const data = files.get(filename);
          if (!data) throw new Error("UNKNOWN_LOCAL_ASSET");
          return data.buffer.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength,
          );
        },
        onStage: () => {},
      },
    );
    assert.deepEqual(result.publicSignals, vector.publicSignals);
  } finally {
    curve = await snarkjs.curves.getCurveFromName("bn128");
    await curve.terminate();
  }
});
