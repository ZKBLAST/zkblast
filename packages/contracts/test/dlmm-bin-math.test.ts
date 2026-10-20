import assert from "node:assert/strict";
import test from "node:test";

import {
  initialBinForHumanPrice,
  nearestBin,
  priceFromBin,
  rawPriceX18,
} from "../scripts/dlmm-bin-math.ts";

test("matches the Solidity parity price at bin zero", () => {
  assert.equal(priceFromBin(0, 25), 10n ** 18n);
  assert.equal(nearestBin(10n ** 18n, 25), 0);
});

test("normalizes WETH 18 decimals against USDG 6 decimals", () => {
  assert.equal(rawPriceX18("4000", 18, 6), 4_000_000_000n);
  const result = initialBinForHumanPrice("4000", 18, 6, 25);
  assert.ok(result.binId < -7_000 && result.binId > -9_000);
  assert.ok(result.deviationBps <= 13);
});

test("round-trips positive and negative bins to their nearest bin", () => {
  for (const binId of [-9_999, -7_740, -1, 1, 4_200, 9_999])
    assert.equal(nearestBin(priceFromBin(binId, 25), 25), binId);
});

test("rejects prices outside the contract range", () => {
  assert.throws(() => nearestBin(1n, 25), /OUT_OF_RANGE/u);
});
