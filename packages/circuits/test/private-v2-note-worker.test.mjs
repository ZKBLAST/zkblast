import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { test } from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const { run } = JSON.parse(
  await readFile(path.join(root, "target/v2-testnet/last-run.json"), "utf8"),
);
const directory = path.join(root, "target/v2-testnet", run);
const source = await readFile(
  path.resolve(root, "../../apps/web/public/zk/private-v2-note-worker.js"),
  "utf8",
);
const wasm = await readFile(
  path.join(directory, "spend-vector_js/spend-vector.wasm"),
);
const fixture = JSON.parse(
  await readFile(path.join(directory, "local-proofs/deposit0.json"), "utf8"),
);
const asset = {
  path: "/zk/testnet/v2/note.wasm",
  sha256: createHash("sha256").update(wasm).digest("hex"),
};

async function execute(override = {}) {
  let resolve;
  const output = new Promise((done) => {
    resolve = done;
  });
  const self = { postMessage: (message) => resolve(message) };
  vm.runInNewContext(source, {
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
    fetch: async () => new Response(wasm),
  });
  await self.onmessage({
    data: {
      id: "local-worker-test",
      asset,
      input: {
        chain_id: "46630",
        settlement: "16384",
        tree_version: "2",
        resource_kind: "0",
        resource_address: "4096",
        pool_model: "0",
        bin_index: "8388608",
        amount: "1000000",
        secret: "101",
        nonce: "201",
      },
      ...override,
    },
  });
  return output;
}

test("bundled v2 note worker runs real WASM and matches a real proof commitment", async () => {
  const result = await execute();
  assert.equal(result.error, undefined);
  assert.equal(result.commitment, fixture.publicSignals[10]);
  assert.match(result.nullifier, /^[1-9][0-9]*$/u);
});

test("bundled v2 note worker fails closed on wrong WASM digest", async () => {
  const result = await execute({ asset: { ...asset, sha256: "0".repeat(64) } });
  assert.equal(result.error, "V2_NOTE_CALCULATION_FAILED");
  assert.equal(result.commitment, undefined);
});
