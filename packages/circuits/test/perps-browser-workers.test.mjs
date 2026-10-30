import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "../../..");
const publicRoot = path.join(root, "apps/web/public/zk");

for (const [name, minimumBytes] of [
  ["perps-position-worker.js", 4_000],
  ["perps-v1-worker.js", 200_000],
]) {
  test(`${name} is a self-contained classic worker bundle`, async () => {
    const source = await readFile(path.join(publicRoot, name), "utf8");

    assert(source.length >= minimumBytes, `${name} is unexpectedly small`);
    assert.match(source, /^"use strict";\(\(\)=>\{/u);
    assert.doesNotMatch(source, /^\s*import\s/mu);
    assert.doesNotMatch(source, /from\s+["'](?:snarkjs|zkblast-v2-calculator|\.\/perps-prover\.mjs)["']/u);
  });
}

test("position worker executes the released mainnet WASM", async () => {
  const source = await readFile(path.join(publicRoot, "perps-position-worker.js"), "utf8");
  const wasm = await readFile(path.join(publicRoot, "mainnet/perps-v1/position-vector.wasm"));
  const manifest = JSON.parse(
    await readFile(path.join(publicRoot, "mainnet/perps-v1/manifest.json"), "utf8"),
  );
  assert.equal(createHash("sha256").update(wasm).digest("hex"), manifest.positionCalculator.sha256);

  let resolveOutput;
  const output = new Promise((resolve) => { resolveOutput = resolve; });
  const self = { postMessage: resolveOutput };
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
      id: "position-worker-test",
      environment: "mainnet",
      asset: manifest.positionCalculator,
      input: {
        chain_id: "4663",
        adapter: "100",
        market_low: "123",
        market_high: "456",
        is_long: "1",
        margin: "1000000",
        leverage_bps: "20000",
        owner_secret: "301",
        owner_nonce: "401",
      },
    },
  });
  const result = await output;
  assert.equal(result.id, "position-worker-test");
  assert.equal(result.error, undefined);
  assert.match(result.commitment, /^[1-9][0-9]*$/u);
  assert.match(result.nullifier, /^[1-9][0-9]*$/u);
});

test("prover worker generates and verifies the released open proof", async () => {
  const source = await readFile(path.join(publicRoot, "perps-v1-worker.js"), "utf8");
  const releaseRoot = path.join(publicRoot, "mainnet/perps-v1");
  const manifest = JSON.parse(await readFile(path.join(releaseRoot, "open-manifest.json"), "utf8"));
  const input = JSON.parse(
    await readFile(path.join(root, "packages/circuits/vectors/perps-v1/open-valid.json"), "utf8"),
  );
  manifest.adapter = "0x0000000000000000000000000000000000000064";
  input.adapter = manifest.adapter;
  const expectedPublicInputs = [
    input.schema_version, input.action, input.chain_id, String(BigInt(input.adapter)), input.custody,
    input.collateral, input.tree_version, input.merkle_root, input.market_low,
    input.market_high, input.is_long, input.margin, input.leverage_bps,
    input.acceptable_price_x18, input.deadline, input.nullifier,
    input.position_commitment, input.refund_commitment, input.relayer,
    input.relayer_fee, input.refund_amount,
  ];
  const messages = [];
  let resolveOutput;
  const output = new Promise((resolve) => { resolveOutput = resolve; });
  const self = {
    postMessage(message) {
      messages.push(message);
      if (message.error || message.stage === "complete") resolveOutput(message);
    },
  };
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
    Response,
    Blob,
    URL,
    setTimeout,
    clearTimeout,
    fetch: async (assetPath) => new Response(
      await readFile(path.join(root, "apps/web/public", assetPath)),
    ),
  });
  await self.onmessage({ data: {
    id: "open-proof-worker-test",
    kind: "open",
    input,
    expectedPublicInputs,
    manifest,
    scope: { environment: "mainnet", chainId: "4663", adapter: manifest.adapter },
  } });
  const result = await output;
  assert.equal(result.error, undefined);
  assert.equal(result.publicSignals.length, 21);
  assert.deepEqual(messages.map(({ stage }) => stage), ["proving", "verifying", "complete"]);
});
