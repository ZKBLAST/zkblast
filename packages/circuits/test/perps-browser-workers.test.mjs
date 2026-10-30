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
