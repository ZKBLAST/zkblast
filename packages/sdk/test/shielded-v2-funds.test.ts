import assert from "node:assert/strict";
import test from "node:test";
import {
  BN254_SCALAR_FIELD,
  fundPublicInputsV2,
  type FundStatementV2,
} from "../src/index.js";

const address = "0x1000000000000000000000000000000000000001";
const context = {
  schemaVersion: 2,
  chainId: 46630n,
  settlement: address,
  treeVersion: 2n,
  asset: address,
  amount: 100n,
} as const;

test("funding statements preserve distinct deposit/withdraw context in 11 public inputs", () => {
  const deposit = fundPublicInputsV2({
    ...context,
    operation: "deposit",
    commitment: 123n,
  });
  const withdrawal = fundPublicInputsV2({
    ...context,
    operation: "withdraw",
    merkleRoot: 456n,
    nullifier: 789n,
    recipient: address,
  });
  assert.equal(deposit.length, 11);
  assert.equal(withdrawal.length, 11);
  assert.deepEqual(deposit.slice(5, 7), [0n, 0n]);
  assert.equal(deposit[10], 123n);
  assert.equal(withdrawal[1], 1n);
  assert.equal(withdrawal[5], 456n);
  assert.equal(withdrawal[6], 789n);
  assert.equal(withdrawal[10], 0n);
});

test("legacy schemas, wrong amount bounds and field aliases cannot enter v2 funding", () => {
  const base = { ...context, operation: "deposit", commitment: 123n } as const;
  for (const change of [
    { schemaVersion: 1 },
    { amount: 0n },
    { amount: 1n << 128n },
    { commitment: BN254_SCALAR_FIELD },
    { treeVersion: 0n },
  ]) {
    assert.throws(() =>
      fundPublicInputsV2({ ...base, ...change } as FundStatementV2),
    );
  }
  assert.throws(() =>
    fundPublicInputsV2({
      ...context,
      operation: "withdraw",
      merkleRoot: 456n,
      nullifier: 0n,
      recipient: address,
    }),
  );
});
