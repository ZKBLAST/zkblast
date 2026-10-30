import assert from "node:assert/strict";
import test from "node:test";
import {
  privatePerpClosePublicInputsV1,
  privatePerpOpenPublicInputsV1,
  type PrivatePerpCloseStatementV1,
  type PrivatePerpOpenStatementV1,
} from "../src/perps-statement.js";

const common = {
  schemaVersion: 1 as const,
  chainId: 4_663n,
  adapter: "0x1111111111111111111111111111111111111111" as const,
  collateral: "0x2222222222222222222222222222222222222222" as const,
  treeVersion: 2n,
  marketId: `0x${"ab".repeat(32)}` as `0x${string}`,
  acceptablePriceX18: 2_000n * 10n ** 18n,
  deadline: 1_800_000_000n,
  relayer: "0x3333333333333333333333333333333333333333" as const,
  relayerFee: 1_000n,
};

const open: PrivatePerpOpenStatementV1 = {
  ...common,
  action: "open",
  custody: "0x4444444444444444444444444444444444444444",
  merkleRoot: 11n,
  isLong: true,
  margin: 1_000_000n,
  leverageBps: 20_000n,
  nullifier: 12n,
  positionCommitment: 13n,
  refundCommitment: 14n,
  refundAmount: 99_000n,
};

const close: PrivatePerpCloseStatementV1 = {
  ...common,
  action: "close",
  custody: "0x4444444444444444444444444444444444444444",
  positionCommitment: 13n,
  positionNullifier: 15n,
  expectedPayout: 1_100_000n,
  payoutCommitment: 16n,
};

test("private Perps v1 freezes open and close public input order", () => {
  const openInputs = privatePerpOpenPublicInputsV1(open);
  const closeInputs = privatePerpClosePublicInputsV1(close);
  assert.equal(openInputs.length, 21);
  assert.equal(closeInputs.length, 17);
  assert.deepEqual(openInputs.slice(0, 2), [1n, 1n]);
  assert.deepEqual(closeInputs.slice(0, 2), [1n, 2n]);
  assert.equal(openInputs[15], open.nullifier);
  assert.deepEqual(openInputs.slice(18), [BigInt(open.relayer), open.relayerFee, open.refundAmount]);
  assert.equal(closeInputs[10], close.positionNullifier);
});

test("private Perps v1 rejects unsafe public statements before proving", () => {
  assert.throws(
    () => privatePerpOpenPublicInputsV1({ ...open, leverageBps: 100_001n }),
    /leverage outside protocol bounds/u,
  );
  assert.throws(
    () => privatePerpOpenPublicInputsV1({ ...open, merkleRoot: 0n }),
    /Invalid private Perps root/u,
  );
  assert.throws(
    () => privatePerpClosePublicInputsV1({ ...close, relayerFee: close.expectedPayout }),
    /relayer fee consumes payout/u,
  );
});
