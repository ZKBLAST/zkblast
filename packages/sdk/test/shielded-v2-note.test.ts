import assert from "node:assert/strict";
import test from "node:test";
import {
  BN254_SCALAR_FIELD,
  assertCanonicalFieldV2,
  shieldedNoteWitnessV2,
  shieldedTermsLimbsV2,
  type ShieldedNoteV2,
} from "../src/index.js";

const contract = "0x1000000000000000000000000000000000000001";
const note: ShieldedNoteV2 = {
  schemaVersion: 2,
  chainId: 46630n,
  settlement: contract,
  treeVersion: 2n,
  resource: { kind: "token", address: contract },
  amount: 100n,
  secret: 123n,
  nonce: 456n,
};

test("v2 private witness canonicalizes token and DAMM/DLMM share identities", () => {
  const token = shieldedNoteWitnessV2(note);
  assert.equal(token.resource_kind, "0");
  assert.equal(token.bin_index, String(1 << 23));
  for (const binId of [-(1n << 23n), -1n, 0n, (1n << 23n) - 1n]) {
    const lp = shieldedNoteWitnessV2({
      ...note,
      resource: { kind: "lp", address: contract, model: "dlmm", binId },
    });
    assert.equal(BigInt(lp.bin_index!) - (1n << 23n), binId);
    assert.equal(lp.resource_kind, "1");
    assert.equal(lp.pool_model, "1");
  }
  const damm = shieldedNoteWitnessV2({
    ...note,
    resource: { kind: "lp", address: contract, model: "damm", binId: 0n },
  });
  assert.equal(damm.pool_model, "0");
});

test("legacy schema and invalid private note bounds are rejected without migration", () => {
  for (const change of [
    { schemaVersion: 1 },
    { secret: 0n },
    { secret: 1n << 248n },
    { nonce: -1n },
    { amount: 0n },
    { amount: 1n << 128n },
    { chainId: 0n },
    { treeVersion: 0n },
    { resource: { kind: "lp", address: contract, model: "damm", binId: 1n } },
  ])
    assert.throws(() =>
      shieldedNoteWitnessV2({ ...note, ...change } as ShieldedNoteV2),
    );
});

test("terms limbs preserve all 256 bits, including hashes exceeding the scalar field", () => {
  const hash = `0x${"ff".repeat(32)}` as const;
  const limbs = shieldedTermsLimbsV2(hash);
  assert.equal(
    (BigInt(limbs.terms_high) << 128n) | BigInt(limbs.terms_low),
    BigInt(hash),
  );
  assert.throws(() => shieldedTermsLimbsV2("0x01"));
  assert.doesNotThrow(() => assertCanonicalFieldV2(BN254_SCALAR_FIELD - 1n));
  assert.throws(() => assertCanonicalFieldV2(BN254_SCALAR_FIELD));
  assert.throws(() => assertCanonicalFieldV2(-1n));
});
