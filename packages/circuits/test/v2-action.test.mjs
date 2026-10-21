import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createActionFixtureBuilder } from "./helpers/v2-fixtures.mjs";

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const { wtns, curves } = require("snarkjs");

async function compile(output, name) {
  await run(
    path.join(root, "node_modules/.bin/circom2"),
    [
      path.join(root, `src/v2/${name}.circom`),
      "--wasm",
      "--r1cs",
      "--sym",
      "-o",
      output,
    ],
    { maxBuffer: 4 * 1024 * 1024 },
  );
  const generated = path.join(output, `${name}_js`);
  return require(path.join(generated, "witness_calculator.js"))(
    await readFile(path.join(generated, `${name}.wasm`)),
  );
}

test("composed 32-level action circuit binds input ownership, outputs and resource conservation", async () => {
  const output = await mkdtemp(path.join(tmpdir(), "zkblast-v2-action-"));
  let curve;
  try {
    const action = await compile(output, "action");
    const publicNames = [
      "schema_version",
      "chain_id",
      "settlement",
      "tree_version",
      "merkle_root",
      "action",
      "terms_low",
      "terms_high",
      "deadline",
      "asset0",
      "asset1",
      "pool",
      "pool_model",
      "bin_index",
      ...[
        "nullifiers",
        "output_commitments",
        "refund_commitments",
        "pool_inflows",
        "pool_outflows",
        "fees",
      ].flatMap((name) => [0, 1, 2].map((r) => `${name}[${r}]`)),
    ];
    const symbols = (
      await readFile(path.join(output, "action.sym"), "utf8")
    ).split("\n");
    for (let i = 0; i < publicNames.length; i++) {
      assert.ok(
        symbols.some((line) => {
          const fields = line.split(",");
          return (
            fields[1] === String(i + 1) &&
            fields[3] === `main.${publicNames[i]}`
          );
        }),
        publicNames[i],
      );
    }
    const notes = await compile(output, "spend-vector");
    const merkle = await compile(output, "merkle-test");
    const { context, note, vector } = createActionFixtureBuilder(notes, merkle);
    const swap = await vector(
      [100, 0, 0],
      [9, 80, 0],
      [0, 80, 0],
      [90, 0, 0],
      [1, 0, 0],
    );
    const add = await vector(
      [100, 200, 0],
      [0, 0, 10],
      [0, 0, 10],
      [100, 200, 0],
      [0, 0, 0],
      { action: "3" },
    );
    const remove = await vector(
      [0, 0, 10],
      [100, 200, 0],
      [100, 200, 0],
      [0, 0, 10],
      [0, 0, 0],
      { action: "4" },
    );
    const dlmmAdd = await vector(
      [100, 200, 0],
      [0, 0, 10],
      [0, 0, 10],
      [100, 200, 0],
      [0, 0, 0],
      { action: "3", pool_model: "1", bin_index: "8388607" },
    );
    const swapWithChange = await vector(
      [100, 50, 10],
      [9, 130, 10],
      [0, 80, 0],
      [90, 0, 0],
      [1, 0, 0],
    );
    for (const valid of [swap, add, remove, dlmmAdd, swapWithChange])
      await assert.doesNotReject(() => action.calculateWitness(valid, true));
    const binaryWitness = await action.calculateWTNSBin(swap, true);
    curve = await curves.getCurveFromName("bn128");
    assert.equal(
      await wtns.check(path.join(output, "action.r1cs"), binaryWitness),
      true,
    );
    const forgedOutput = await vector(
      [100, 0, 0],
      [9, 81, 0],
      [0, 80, 0],
      [90, 0, 0],
      [1, 0, 0],
    );
    const forgedShares = await vector(
      [100, 200, 0],
      [0, 0, 11],
      [0, 0, 10],
      [100, 200, 0],
      [0, 0, 0],
      { action: "3" },
    );
    const wrongAction = { ...swap, action: "3" };
    const oldInput = await note(0, 100, 101, 201, context);
    const oldShare = await note(2, 10, 103, 203, context);
    const inflatedRefund = await note(0, 101, 501, 601, context);
    const oneSided = await vector(
      [100, 0, 0],
      [0, 0, 10],
      [0, 0, 10],
      [100, 0, 0],
      [0, 0, 0],
      { action: "3", pool_model: "1", bin_index: "8388607" },
    );
    for (const invalid of [
      forgedOutput,
      forgedShares,
      wrongAction,
      { ...swap, schema_version: "1" },
      { ...swap, chain_id: "4663" },
      { ...swap, settlement: "101" },
      { ...swap, merkle_root: "1" },
      { ...swap, input_secrets: [999, 102, 103] },
      { ...swap, nullifiers: ["1", "0", "0"] },
      { ...swap, nullifiers: [swap.nullifiers[0], "1", "0"] },
      { ...swap, output_commitments: ["1", swap.output_commitments[1], "0"] },
      { ...swap, fees: [0, 0, 0] },
      { ...remove, pool: "31" },
      { ...dlmmAdd, bin_index: "8388606" },
      { ...swap, terms_high: String(1n << 128n) },
      { ...swap, action: "1" },
      { ...swap, refund_commitments: ["1", "0", "0"] },
      { ...swap, refund_secrets: [999, 502, 503] },
      {
        ...swap,
        refund_commitments: [oldInput.commitment, "0", "0"],
        refund_secrets: [101, 502, 503],
        refund_nonces: [201, 602, 603],
      },
      {
        ...swapWithChange,
        output_commitments: [
          swapWithChange.output_commitments[0],
          swapWithChange.output_commitments[1],
          oldShare.commitment,
        ],
        output_secrets: [301, 302, 103],
        output_nonces: [401, 402, 203],
      },
      { ...swap, refund_commitments: [inflatedRefund.commitment, "0", "0"] },
      oneSided,
    ])
      await assert.rejects(() => action.calculateWitness(invalid, true));
    console.log(
      "composed action: 5 valid, 22 rejected; real R1CS witness checked; refunds exact and fresh",
    );
  } finally {
    await curve?.terminate();
    await rm(output, { recursive: true, force: true });
  }
});
