import assert from "node:assert/strict";
import test from "node:test";
import { decodeAbiParameters } from "viem";
import {
  BN254_SCALAR_FIELD,
  encodePrivateActionStatementV2,
  privateActionPublicInputsV2,
  privateActionStatementHashV2,
  type PrivateActionStatementV2,
} from "../src/index.js";

const a = "0x1000000000000000000000000000000000000001";
const b = "0x2000000000000000000000000000000000000002";
const statement: PrivateActionStatementV2 = {
  schemaVersion: 2,
  chainId: 46630n,
  settlement: a,
  treeVersion: 2n,
  merkleRoot: 123n,
  action: "swap",
  termsHash: `0x${"ff".repeat(32)}`,
  deadline: 1000n,
  asset0: a,
  asset1: b,
  pool: b,
  model: "dlmm",
  binId: -1n,
  nullifiers: [1n, 0n, 0n],
  outputCommitments: [2n, 3n, 0n],
  refundCommitments: [4n, 0n, 0n],
  poolInflows: [0n, 80n, 0n],
  poolOutflows: [90n, 0n, 0n],
  fees: [1n, 0n, 0n],
};

test("v2 public statement has exactly 32 ordered fields and ABI roundtrips", () => {
  const values = privateActionPublicInputsV2(statement);
  assert.equal(values.length, 32);
  assert.equal(values[5], 2n);
  assert.equal(values[13], (1n << 23n) - 1n);
  assert.deepEqual(values.slice(14, 17), statement.nullifiers);
  assert.deepEqual(values.slice(17, 20), statement.outputCommitments);
  const [decoded] = decodeAbiParameters(
    [{ type: "uint256[32]" }],
    encodePrivateActionStatementV2(statement),
  );
  assert.deepEqual(decoded, values);
  assert.notEqual(
    privateActionStatementHashV2(statement),
    privateActionStatementHashV2({
      ...statement,
      outputCommitments: [2n, 4n, 0n],
    }),
  );
  assert.notEqual(
    privateActionStatementHashV2(statement),
    privateActionStatementHashV2({ ...statement, fees: [2n, 0n, 0n] }),
  );
});

test("rejects v1 schema, duplicate slots, field aliases and invalid amounts", () => {
  const mutations: Partial<PrivateActionStatementV2>[] = [
    { schemaVersion: 1 as 2 },
    { nullifiers: [1n, 1n, 0n] },
    { outputCommitments: [0n, 0n, 0n] },
    { merkleRoot: BN254_SCALAR_FIELD },
    { fees: [1n, 0n, 1n] },
    { poolInflows: [0n, 1n << 128n, 0n] },
    { model: "damm" },
    { asset1: a },
    { deadline: 0n },
  ];
  for (const mutation of mutations)
    assert.throws(() =>
      privateActionPublicInputsV2({ ...statement, ...mutation }),
    );
});
