import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import * as snarkjs from "snarkjs";
import { encodeAbiParameters, keccak256 } from "viem";
import { shieldedTermsHashV2 } from "../../sdk/src/shielded-v2-terms.ts";
import { createActionFixtureBuilder } from "../test/helpers/v2-fixtures.mjs";
import { writeLocalProofTest } from "../test/helpers/v2-evm-template.mjs";

// Synthetic fixed-secret LOCAL fixtures only. Never deposit funds to these notes.
const root = path.resolve(import.meta.dirname, "..");
const target = path.join(root, "target/v2-testnet");
const name =
  process.argv[2] ??
  JSON.parse(await readFile(path.join(target, "last-run.json"), "utf8")).run;
if (!/^run-[A-Za-z0-9_-]+$/u.test(name)) throw new Error("Invalid local run");
const directory = path.join(target, name);
const release = JSON.parse(
  await readFile(path.join(directory, "release.local.json"), "utf8"),
);
assert.equal(release.environment, "testnet");
assert.equal(release.eligibleForDeployment, false);
const sha = async (file) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
const require = createRequire(import.meta.url);
const word = (value) => `0x${BigInt(value).toString(16).padStart(64, "0")}`;
const addr = (value) => `0x${BigInt(value).toString(16).padStart(40, "0")}`;
const json = (file, value) =>
  writeFile(
    file,
    `${JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item), 2)}\n`,
  );
async function calculator(circuit) {
  const folder = path.join(directory, `${circuit}_js`);
  return require(path.join(folder, "witness_calculator.js"))(
    await readFile(path.join(folder, `${circuit}.wasm`)),
  );
}

let curve;
try {
  for (const circuit of ["action", "fund"]) {
    const a = release.artifacts[circuit];
    assert.equal(
      await sha(path.join(directory, `${circuit}.r1cs`)),
      a.r1csSha256,
    );
    assert.equal(
      await sha(path.join(directory, `${circuit}_js/${circuit}.wasm`)),
      a.wasmSha256,
    );
    assert.equal(
      await sha(path.join(directory, `${circuit}-testnet.zkey`)),
      a.provingKeySha256,
    );
    assert.equal(
      await sha(path.join(directory, `${circuit}-vkey.json`)),
      a.verificationKeySha256,
    );
  }
  const builder = createActionFixtureBuilder(
    await calculator("spend-vector"),
    await calculator("merkle-test"),
  );
  const ctx = {
    ...builder.context,
    settlement: "16384",
    asset0: "4096",
    asset1: "8192",
    pool: "12288",
  };
  const amount = 1_000_000;
  const dep0 = await builder.note(0, amount, 101, 201, ctx);
  const dep1 = await builder.note(1, amount, 102, 202, ctx);
  function deposit(r, note) {
    return {
      schema_version: "2",
      operation: "0",
      chain_id: ctx.chain_id,
      settlement: ctx.settlement,
      tree_version: ctx.tree_version,
      merkle_root: "0",
      nullifier: "0",
      asset: r === 0 ? ctx.asset0 : ctx.asset1,
      amount,
      recipient: "0",
      commitment: note.commitment,
      secret: r === 0 ? 101 : 102,
      nonce: r === 0 ? 201 : 202,
      leaf_index: 0,
      path_siblings: Array(32).fill("1"),
      path_directions: Array(32).fill("0"),
    };
  }
  async function withdrawal(r, value, secret, nonce, leaves, leafIndex) {
    const note = await builder.note(r, value, secret, nonce, ctx);
    const tree = await builder.treePaths(leaves, [leafIndex, 0, 0]);
    return {
      ...deposit(r, note),
      operation: "1",
      amount: value,
      commitment: "0",
      merkle_root: tree.root,
      nullifier: note.nullifier,
      recipient: "20480",
      secret,
      nonce,
      leaf_index: leafIndex,
      path_siblings: tree.siblings[0],
      path_directions: tree.directions[0],
    };
  }
  function bindTerms(vector, action) {
    const refund = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
        vector.refund_commitments.map(word),
      ),
    );
    const terms = {
      chainId: 46630n,
      settlement: addr(ctx.settlement),
      action,
      pool: addr(ctx.pool),
      model: "damm",
      binId: 0n,
      asset0: addr(ctx.asset0),
      asset1: addr(ctx.asset1),
      amount0: BigInt(vector.pool_outflows[0]),
      amount1: BigInt(vector.pool_outflows[1]),
      shares: BigInt(vector.pool_outflows[2]),
      minimum0:
        action === "add-liquidity" ? 0n : BigInt(vector.pool_inflows[0]),
      minimum1:
        action === "add-liquidity" ? 0n : BigInt(vector.pool_inflows[1]),
      minimumShares: action === "add-liquidity" ? 1n : 0n,
      maximumFee0: 0n,
      maximumFee1: 0n,
      feeRecipient: addr(20480),
      deadline: BigInt(ctx.deadline),
      refundCommitment: refund,
      outputCommitment0: word(vector.output_commitments[0]),
      outputCommitment1: word(vector.output_commitments[1]),
    };
    const hash = BigInt(shieldedTermsHashV2(terms));
    vector.terms_low = String(hash & ((1n << 128n) - 1n));
    vector.terms_high = String(hash >> 128n);
    return terms;
  }
  const add = await builder.vector(
    [amount, amount, 0],
    [0, 0, amount - 1000],
    [0, 0, amount - 1000],
    [amount, amount, 0],
    [0, 0, 0],
    { ...ctx, action: "3" },
  );
  const addTerms = bindTerms(add, "add-liquidity");
  const lpLeaves = [
    dep0.commitment,
    dep1.commitment,
    add.output_commitments[2],
  ];
  const remove = await builder.vector(
    [0, 0, amount - 1000],
    [amount - 1000, amount - 1000, 0],
    [amount - 1000, amount - 1000, 0],
    [0, 0, amount - 1000],
    [0, 0, 0],
    { ...ctx, action: "4" },
    {
      inputSecrets: [101, 102, 303],
      inputNonces: [201, 202, 403],
      treeLeaves: lpLeaves,
    },
  );
  const removeTerms = bindTerms(remove, "remove-liquidity");
  const redeemedLeaves = [
    ...lpLeaves,
    remove.output_commitments[0],
    remove.output_commitments[1],
  ];
  const refundLeaves = [
    dep0.commitment,
    dep1.commitment,
    add.refund_commitments[0],
    add.refund_commitments[1],
  ];
  const swapOutput = Number(
    (BigInt(amount) * 997000n * 100_000_000n) /
      (100_000_000n * 1_000_000n + BigInt(amount) * 997000n),
  );
  const swap = await builder.vector(
    [amount, 0, 0],
    [0, swapOutput, 0],
    [0, swapOutput, 0],
    [amount, 0, 0],
    [0, 0, 0],
    ctx,
  );
  const swapTerms = bindTerms(swap, "swap");
  const cases = {
    deposit0: { circuit: "fund", input: deposit(0, dep0) },
    deposit1: { circuit: "fund", input: deposit(1, dep1) },
    originalWithdraw0: {
      circuit: "fund",
      input: await withdrawal(
        0,
        amount,
        101,
        201,
        [dep0.commitment, dep1.commitment],
        0,
      ),
    },
    add: { circuit: "action", input: add, terms: addTerms },
    remove: { circuit: "action", input: remove, terms: removeTerms },
    redeem0: {
      circuit: "fund",
      input: await withdrawal(0, amount - 1000, 301, 401, redeemedLeaves, 3),
    },
    redeem1: {
      circuit: "fund",
      input: await withdrawal(1, amount - 1000, 302, 402, redeemedLeaves, 4),
    },
    refund0: {
      circuit: "fund",
      input: await withdrawal(0, amount, 501, 601, refundLeaves, 2),
    },
    refund1: {
      circuit: "fund",
      input: await withdrawal(1, amount, 502, 602, refundLeaves, 3),
    },
    swap: { circuit: "action", input: swap, terms: swapTerms },
    swapWithdraw: {
      circuit: "fund",
      input: await withdrawal(
        1,
        swapOutput,
        302,
        402,
        [dep0.commitment, swap.output_commitments[1]],
        1,
      ),
    },
  };
  const output = path.join(directory, "local-proofs");
  const fundCalculator = await calculator("fund");
  const depositVector = cases.deposit0.input;
  const withdrawalVector = cases.redeem0.input;
  const invalidWitnesses = [
    { ...depositVector, schema_version: "1" },
    { ...depositVector, amount: 0 },
    { ...depositVector, amount: String(1n << 128n) },
    { ...depositVector, secret: 0 },
    { ...depositVector, nonce: String(1n << 128n) },
    { ...depositVector, asset: "0" },
    { ...depositVector, settlement: "0" },
    { ...depositVector, chain_id: "4663" },
    { ...depositVector, commitment: "1" },
    { ...depositVector, recipient: "1" },
    { ...withdrawalVector, merkle_root: "1" },
    { ...withdrawalVector, nullifier: "1" },
    { ...withdrawalVector, recipient: "0" },
  ];
  for (const invalid of invalidWitnesses) {
    await assert.rejects(() => fundCalculator.calculateWitness(invalid, true));
  }
  process.stdout.write(
    `${invalidWitnesses.length} invalid v2 funding witnesses rejected\n`,
  );
  await mkdir(output, { recursive: true });
  curve = await snarkjs.curves.getCurveFromName("bn128");
  const results = {};
  for (const [caseName, item] of Object.entries(cases)) {
    process.stdout.write(`Proving synthetic local ${caseName}…\n`);
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      item.input,
      path.join(directory, `${item.circuit}_js/${item.circuit}.wasm`),
      path.join(directory, `${item.circuit}-testnet.zkey`),
    );
    const vkey = JSON.parse(
      await readFile(path.join(directory, `${item.circuit}-vkey.json`), "utf8"),
    );
    assert.equal(
      await snarkjs.groth16.verify(vkey, publicSignals, proof),
      true,
      caseName,
    );
    const changed = [...publicSignals];
    changed[0] = "1";
    assert.equal(
      await snarkjs.groth16.verify(vkey, changed, proof),
      false,
      `${caseName}: changed schema accepted`,
    );
    const call = JSON.parse(
      `[${await snarkjs.groth16.exportSolidityCallData(proof, publicSignals)}]`,
    );
    results[caseName] = {
      circuit: item.circuit,
      proof,
      publicSignals,
      calldata: call,
      terms: item.terms,
      positiveVerified: true,
      alteredRejected: true,
    };
    await json(path.join(output, `${caseName}.json`), results[caseName]);
  }
  await writeLocalProofTest(name, directory, release, results);
  await json(path.join(directory, "real-proof-results.local.json"), {
    syntheticOnly: true,
    eligibleForDeployment: false,
    cases: Object.keys(results),
    positive: Object.keys(results).length,
    alteredPublicInputsRejected: Object.keys(results).length,
    invalidFundingWitnessesRejected: invalidWitnesses.length,
    publicPreparedPhase2Sha256: await sha(
      path.join(directory, "pot16-v2-phase2.ptau"),
    ),
  });
  process.stdout.write(
    `${Object.keys(results).length} real Groth16 proofs verified; altered public inputs rejected. Local EVM fixtures generated, not deployed.\n`,
  );
} finally {
  await curve?.terminate();
}
