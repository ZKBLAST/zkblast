import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);

test("v2 circuit conserves swap and LP balances and rejects inflation/range attacks", async () => {
  const output = await mkdtemp(path.join(tmpdir(), "zkblast-v2-conservation-"));
  try {
    await run(path.join(root, "node_modules/.bin/circom2"), [
      path.join(root, "src/v2/conservation-test.circom"),
      "--wasm",
      "--r1cs",
      "-o",
      output,
    ]);
    const generated = path.join(output, "conservation-test_js");
    const build = require(path.join(generated, "witness_calculator.js"));
    const calculator = await build(
      await readFile(path.join(generated, "conservation-test.wasm")),
    );
    const swap = {
      input_amounts: [100, 0, 0],
      output_amounts: [9, 80, 0],
      pool_inflows: [0, 80, 0],
      pool_outflows: [90, 0, 0],
      fees: [1, 0, 0],
    };
    const add = {
      input_amounts: [100, 200, 0],
      output_amounts: [0, 0, 10],
      pool_inflows: [0, 0, 10],
      pool_outflows: [100, 200, 0],
      fees: [0, 0, 0],
    };
    const remove = {
      input_amounts: [0, 0, 10],
      output_amounts: [100, 200, 0],
      pool_inflows: [100, 200, 0],
      pool_outflows: [0, 0, 10],
      fees: [0, 0, 0],
    };
    for (const vector of [swap, add, remove]) {
      await assert.doesNotReject(() =>
        calculator.calculateWitness(vector, true),
      );
    }
    for (const vector of [
      { ...swap, output_amounts: [9, 81, 0] },
      { ...swap, fees: [0, 0, 0] },
      { ...swap, input_amounts: [-1, 0, 0] },
      { ...swap, input_amounts: [(1n << 128n).toString(), 0, 0] },
      { ...add, output_amounts: [0, 0, 11] },
      { ...remove, pool_outflows: [0, 0, 9] },
      { ...add, output_amounts: [0, 0, 9], fees: [0, 0, 1] },
    ])
      await assert.rejects(() => calculator.calculateWitness(vector, true));
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
