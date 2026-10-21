import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPrivateConservationV2,
  shieldedTermsHashV2,
  validateShieldedTermsV2,
  type ShieldedTermsV2,
} from "../src/index.js";

const a = "0x1000000000000000000000000000000000000001";
const b = "0x2000000000000000000000000000000000000002";
const word = (n: number): `0x${string}` =>
  `0x${n.toString(16).padStart(64, "0")}`;
const terms: ShieldedTermsV2 = {
  chainId: 46630n,
  settlement: a,
  action: "swap",
  pool: b,
  model: "dlmm",
  binId: -1n,
  asset0: a,
  asset1: b,
  amount0: 100n,
  amount1: 0n,
  shares: 0n,
  minimum0: 0n,
  minimum1: 90n,
  minimumShares: 0n,
  maximumFee0: 1n,
  maximumFee1: 0n,
  feeRecipient: b,
  deadline: 1000n,
  refundCommitment: word(1),
  outputCommitment0: word(2),
  outputCommitment1: word(3),
};

test("v2 swap terms encode deterministically and bind every field", () => {
  const hash = shieldedTermsHashV2(terms);
  // Same public fixture is asserted by SettlementTermsV2.t.sol.
  assert.equal(
    hash,
    "0xce98b953664fcde3252efef4108551a1a4e4161a13cceb7a25ce704fc883df8b",
  );
  assert.equal(hash, shieldedTermsHashV2({ ...terms }));
  const changes: Partial<ShieldedTermsV2>[] = [
    { chainId: 4663n },
    { settlement: b },
    { pool: a },
    { binId: 2n },
    { amount0: 101n },
    { minimum1: 91n },
    { maximumFee0: 2n },
    { maximumFee1: 1n },
    { feeRecipient: a },
    { deadline: 1001n },
    { refundCommitment: word(4) },
    { outputCommitment0: word(4) },
    { outputCommitment1: word(4) },
    { model: "damm", binId: 0n },
  ];
  for (const change of changes)
    assert.notEqual(hash, shieldedTermsHashV2({ ...terms, ...change }));
});

test("v2 rejects malformed domains, unbounded amounts, duplicate outputs and unbounded swaps", () => {
  const changes: Partial<ShieldedTermsV2>[] = [
    { chainId: 0n },
    { deadline: 0n },
    { asset1: a },
    { amount0: -1n },
    { amount0: 1n << 128n },
    { binId: 1n << 23n },
    { model: "damm" },
    { minimum1: 0n },
    { shares: 1n },
    { amount1: 1n },
    { refundCommitment: word(0) },
    { outputCommitment1: word(2) },
    { action: "withdraw" as ShieldedTermsV2["action"] },
  ];
  for (const change of changes)
    assert.throws(() => validateShieldedTermsV2({ ...terms, ...change }));
});

test("LP add/remove have distinct action hashes and constrained input/output shapes", () => {
  const add: ShieldedTermsV2 = {
    ...terms,
    action: "add-liquidity",
    amount1: 100n,
    minimum1: 0n,
    minimumShares: 5n,
  };
  const remove: ShieldedTermsV2 = {
    ...terms,
    action: "remove-liquidity",
    amount0: 0n,
    shares: 5n,
  };
  assert.notEqual(shieldedTermsHashV2(add), shieldedTermsHashV2(remove));
  assert.doesNotThrow(() =>
    validateShieldedTermsV2({
      ...add,
      outputCommitment0: word(0),
      outputCommitment1: word(0),
    }),
  );
  assert.throws(() =>
    validateShieldedTermsV2({
      ...remove,
      outputCommitment0: word(0),
      outputCommitment1: word(0),
    }),
  );
  assert.throws(() => validateShieldedTermsV2({ ...add, minimumShares: 0n }));
  assert.throws(() => validateShieldedTermsV2({ ...add, amount1: 0n }));
  assert.throws(() => validateShieldedTermsV2({ ...remove, amount0: 1n }));
});

const token0 = `token:${a}`;
const token1 = `token:${b}`;
const lp = `lp:${b}:dlmm:-1`;

test("private swap conserves both assets including change and fees", () => {
  const transition = {
    inputNotes: [{ asset: token0, amount: 100n }],
    poolDeltas: [
      { asset: token0, amount: -90n },
      { asset: token1, amount: 80n },
    ],
    outputNotes: [
      { asset: token0, amount: 9n },
      { asset: token1, amount: 80n },
    ],
    fees: [{ asset: token0, amount: 1n }],
  };
  assert.doesNotThrow(() => assertPrivateConservationV2(transition));
  assert.throws(() => assertPrivateConservationV2({ ...transition, fees: [] }));
  assert.throws(() =>
    assertPrivateConservationV2({
      ...transition,
      outputNotes: [{ asset: token1, amount: 90n }],
    }),
  );
});

test("LP add and removal conserve share resources independently from token notes", () => {
  const add = {
    inputNotes: [
      { asset: token0, amount: 100n },
      { asset: token1, amount: 200n },
    ],
    poolDeltas: [
      { asset: token0, amount: -100n },
      { asset: token1, amount: -200n },
      { asset: lp, amount: 10n },
    ],
    outputNotes: [{ asset: lp, amount: 10n }],
    fees: [],
  };
  assert.doesNotThrow(() => assertPrivateConservationV2(add));
  assert.doesNotThrow(() =>
    assertPrivateConservationV2({
      inputNotes: add.outputNotes,
      outputNotes: add.inputNotes,
      poolDeltas: add.poolDeltas.map((entry) => ({
        ...entry,
        amount: -entry.amount,
      })),
      fees: [],
    }),
  );
  assert.throws(() =>
    assertPrivateConservationV2({
      ...add,
      outputNotes: [{ asset: `lp:${b}:dlmm:0`, amount: 10n }],
    }),
  );
  assert.throws(() =>
    assertPrivateConservationV2({
      ...add,
      outputNotes: [{ asset: token1, amount: 10n }],
    }),
  );
  assert.throws(() =>
    assertPrivateConservationV2({
      ...add,
      outputNotes: [{ asset: lp, amount: 9n }],
      fees: [{ asset: lp, amount: 1n }],
    }),
  );
});

test("rejects negative notes, invalid resources and noncanonical bins", () => {
  for (const asset of ["legacy-v1", `lp:${b}:dlmm:-0`, `lp:${b}:dlmm:01`]) {
    assert.throws(() =>
      assertPrivateConservationV2({
        inputNotes: [{ asset, amount: 1n }],
        outputNotes: [{ asset, amount: 1n }],
        poolDeltas: [],
        fees: [],
      }),
    );
  }
  assert.throws(() =>
    assertPrivateConservationV2({
      inputNotes: [{ asset: token0, amount: -1n }],
      outputNotes: [{ asset: token0, amount: -1n }],
      poolDeltas: [],
      fees: [],
    }),
  );
});
