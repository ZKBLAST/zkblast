import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = (
  await readFile(
    new URL("../browser/withdraw-worker.js", import.meta.url),
    "utf8",
  )
).replace(/^import[\s\S]*?;\s*$/gmu, "");

async function run({ chainId = 46630, corrupt = false } = {}) {
  const messages = [];
  let provingCalls = 0;
  let manifestCalls = 0;
  const asset = { path: "/zk/testnet/key.json", sha256: "expected" };
  const context = {
    self: { postMessage: (message) => messages.push(message) },
    TextDecoder,
    AbortSignal,
    Uint8Array,
    Error,
    testnetRelease: {},
    fetch: async () => new Response("{}"),
    sha256Hex: async () => (corrupt ? "wrong" : "expected"),
    fetchProverManifest: async () => {
      manifestCalls++;
      return { assets: { wasm: asset, zkey: asset, verificationKey: asset } };
    },
    validateProverManifest: (manifest, network) => {
      if (!manifest || network.chainId !== 46630)
        throw new Error("PROVER_NETWORK_MISMATCH");
      return manifest;
    },
    groth16: {
      fullProve: async () => {
        provingCalls++;
        return { proof: {}, publicSignals: [] };
      },
      verify: async () => true,
    },
  };
  vm.runInNewContext(source, context);
  await context.self.onmessage({
    data: { id: "unit-fixture", input: { chain_id: String(chainId) } },
  });
  return { messages, provingCalls, manifestCalls };
}

test("legacy testnet requests use the pinned testnet manifest compatibility path", async () => {
  const result = await run();
  assert.equal(result.manifestCalls, 1);
  assert.equal(result.provingCalls, 1);
  assert.equal(result.messages.at(-1).stage, "complete");
});

test("legacy mainnet requests cannot fall back to a testnet release", async () => {
  const result = await run({ chainId: 4663 });
  assert.equal(result.manifestCalls, 0);
  assert.equal(result.provingCalls, 0);
  assert.equal(result.messages.at(-1).error, "PROVER_NETWORK_MISMATCH");
});

test("asset integrity failure stops proving before private input processing", async () => {
  const result = await run({ corrupt: true });
  assert.equal(result.provingCalls, 0);
  assert.equal(result.messages.at(-1).error, "PROVER_ASSET_INTEGRITY_FAILED");
});
