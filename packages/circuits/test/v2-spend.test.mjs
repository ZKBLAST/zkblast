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

async function compile(output, name) {
  await run(
    path.join(root, "node_modules/.bin/circom2"),
    [
      path.join(root, `src/v2/${name}.circom`),
      "--wasm",
      "--r1cs",
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

test("32-level v2 spend binds ownership, resources, network, nullifier and action terms", async () => {
  const output = await mkdtemp(path.join(tmpdir(), "zkblast-v2-spend-"));
  try {
    const generator = await compile(output, "spend-vector");
    const spend = await compile(output, "spend-proof");
    const outputNote = await compile(output, "output-note");
    const base = {
      chain_id: "46630",
      settlement: "1234",
      tree_version: "2",
      resource_kind: "0",
      resource_address: "5678",
      pool_model: "0",
      bin_index: String(1 << 23),
      amount: "1000000",
      secret: "123456789",
      nonce: "987654321",
      action: "2",
      terms_low: "123",
      terms_high: "456",
      deadline: "2000000000",
      path_siblings: Array(32).fill("0"),
      path_directions: ["1", ...Array(31).fill("0")],
    };
    async function vector(values) {
      const witness = await generator.calculateWitness(values, true);
      const [, commitment, merkle_root, nullifier, authorization] =
        witness.map(String);
      return {
        commitment,
        input: {
          ...values,
          schema_version: "2",
          leaf_index: "1",
          merkle_root,
          nullifier,
          authorization,
        },
      };
    }
    const token = await vector(base);
    await assert.doesNotReject(() => spend.calculateWitness(token.input, true));
    const outputInput = Object.fromEntries(
      [
        "chain_id",
        "settlement",
        "tree_version",
        "resource_kind",
        "resource_address",
        "pool_model",
        "bin_index",
        "amount",
        "secret",
        "nonce",
      ].map((key) => [key, base[key]]),
    );
    outputInput.output_commitment = token.commitment;
    await assert.doesNotReject(() =>
      outputNote.calculateWitness(outputInput, true),
    );
    for (const [key, value] of [
      ["output_commitment", "1"],
      ["amount", "1000001"],
      ["secret", "123456788"],
      ["resource_kind", "1"],
      ["chain_id", "4663"],
    ]) {
      await assert.rejects(() =>
        outputNote.calculateWitness({ ...outputInput, [key]: value }, true),
      );
    }
    let negatives = 0;
    for (const [field, value] of [
      ["schema_version", "1"],
      ["chain_id", "4663"],
      ["settlement", "1235"],
      ["tree_version", "3"],
      ["merkle_root", "1"],
      ["nullifier", "1"],
      ["secret", "123456788"],
      ["nonce", "987654320"],
      ["amount", "999999"],
      ["resource_address", "5679"],
      ["resource_kind", "1"],
      ["leaf_index", "0"],
      ["action", "3"],
      ["action", "1"],
      ["terms_low", "124"],
      ["terms_high", "457"],
      ["deadline", "2000000001"],
      ["authorization", "1"],
      ["terms_low", String(1n << 128n)],
      ["secret", String(1n << 248n)],
      ["amount", "0"],
      ["pool_model", "1"],
      ["bin_index", "0"],
    ]) {
      await assert.rejects(
        () => spend.calculateWitness({ ...token.input, [field]: value }, true),
        field,
      );
      negatives++;
    }
    await assert.rejects(() =>
      spend.calculateWitness(
        { ...token.input, path_directions: ["2", ...Array(31).fill("0")] },
        true,
      ),
    );
    negatives++;
    const add = await vector({ ...base, action: "3" });
    const remove = await vector({ ...base, action: "4" });
    assert.equal(add.input.nullifier, token.input.nullifier);
    assert.equal(remove.input.nullifier, token.input.nullifier);
    assert.notEqual(add.input.authorization, token.input.authorization);
    for (const values of [add, remove])
      await assert.doesNotReject(() =>
        spend.calculateWitness(values.input, true),
      );
    for (const model of ["0", "1"]) {
      const lp = await vector({
        ...base,
        resource_kind: "1",
        pool_model: model,
        bin_index: model === "0" ? base.bin_index : "8388607",
      });
      assert.notEqual(lp.commitment, token.commitment);
      await assert.doesNotReject(() => spend.calculateWitness(lp.input, true));
      await assert.rejects(() =>
        spend.calculateWitness({ ...lp.input, bin_index: "8388606" }, true),
      );
      negatives++;
    }
    console.log(
      `v2 spend: 5 valid witnesses, ${negatives} rejected mutations; output note: 1 valid, 5 rejected; action-independent nullifier checked`,
    );
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
