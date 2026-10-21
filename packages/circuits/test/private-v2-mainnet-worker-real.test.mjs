import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import vm from "node:vm";
import * as snarkjs from "snarkjs";
import { provePrivateV2 } from "../browser/private-v2-prover.mjs";

test("mainnet note worker and browser prover protocol use isolated real artifacts", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const { candidate } = JSON.parse(
    await readFile(
      path.join(root, "target/v2-mainnet/last-candidate.json"),
      "utf8",
    ),
  );
  assert.match(candidate, /^candidate-[\w-]+$/u);
  const publicRoot = path.join(root, "target/v2-mainnet", candidate, "public");
  const release = JSON.parse(
    await readFile(
      path.join(publicRoot, "zk/mainnet/v2/manifest.json"),
      "utf8",
    ),
  );
  const noteInput = {
    chain_id: "4663",
    settlement: String(BigInt(release.settlement)),
    tree_version: "2",
    resource_kind: "0",
    resource_address: "4096",
    pool_model: "0",
    bin_index: "8388608",
    amount: "1",
    secret: "101",
    nonce: "201",
  };
  const files = new Map();
  for (const asset of [
    release.noteCalculator,
    ...Object.values(release.fund.assets),
  ])
    files.set(asset.path, await readFile(path.join(publicRoot, asset.path)));
  const fetchAsset = async (filename) => {
    assert.match(filename, /^\/zk\/mainnet\/v2\/[\w.-]+$/u);
    const data = files.get(filename);
    assert.ok(data);
    return data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    );
  };
  let resolve;
  const result = new Promise((done) => {
    resolve = done;
  });
  const self = { postMessage: (value) => resolve(value) };
  vm.runInNewContext(
    await readFile(
      path.join(root, "../../apps/web/public/zk/private-v2-note-worker.js"),
      "utf8",
    ),
    {
      self,
      WebAssembly,
      Uint8Array,
      Uint32Array,
      ArrayBuffer,
      DataView,
      TextEncoder,
      TextDecoder,
      crypto,
      AbortSignal,
      console,
      fetch: async (filename) => new Response(await fetchAsset(filename)),
    },
  );
  await self.onmessage({
    data: {
      id: "synthetic-mainnet-note",
      input: noteInput,
      asset: release.noteCalculator,
    },
  });
  const calculated = await result;
  assert.equal(calculated.error, undefined);
  const input = {
    schema_version: "2",
    operation: "0",
    chain_id: noteInput.chain_id,
    settlement: noteInput.settlement,
    tree_version: "2",
    amount: "1",
    secret: "101",
    nonce: "201",
    merkle_root: "0",
    nullifier: "0",
    asset: "4096",
    recipient: "0",
    commitment: calculated.commitment,
    leaf_index: "0",
    path_siblings: Array(32).fill("0"),
    path_directions: Array(32).fill("0"),
  };
  const signals = [
    "2",
    "0",
    "4663",
    noteInput.settlement,
    "2",
    "0",
    "0",
    "4096",
    "1",
    "0",
    calculated.commitment,
  ];
  const scope = {
    environment: "mainnet",
    chainId: "4663",
    settlement: release.settlement,
    treeVersion: "2",
  };
  let curve;
  try {
    const proof = await provePrivateV2(
      {
        kind: "fund",
        input,
        scope,
        expectedPublicInputs: signals,
        manifest: { ...scope, schemaVersion: 2, ...release.fund },
      },
      {
        groth16: snarkjs.groth16,
        fetchAsset,
        sha256: async (bytes) =>
          createHash("sha256").update(new Uint8Array(bytes)).digest("hex"),
        onStage: () => {},
      },
    );
    assert.deepEqual(proof.publicSignals, signals);
  } finally {
    curve = await snarkjs.curves.getCurveFromName("bn128");
    await curve.terminate();
  }
});
