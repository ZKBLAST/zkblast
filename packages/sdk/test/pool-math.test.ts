import assert from "node:assert/strict";
import test from "node:test";

import {
  allocateByWeights,
  binFromPrice,
  liquidityShapeWeights,
  pairOrientation,
  priceFromBin,
  quotePerBaseX18,
} from "../src/pool-math.js";

const solidityVectors = [
  [-10_000, 1, 367_897_834_377_124_200n],
  [-10, 25, 975_340_340_235_394_666n],
  [-1, 25, 997_506_234_413_965_087n],
  [0, 25, 1_000_000_000_000_000_000n],
  [1, 25, 1_002_500_000_000_000_000n],
  [10, 25, 1_025_283_133_227_785_717n],
  [10_000, 1, 2_718_145_926_825_221_236n],
] as const;

test("priceFromBin matches fixed Solidity BinPriceMath vectors", () => {
  for (const [binId, step, expected] of solidityVectors)
    assert.equal(priceFromBin(binId, step), expected);
});

test("binFromPrice returns the exact or lower encoded bin", () => {
  for (const [binId, step, price] of solidityVectors) {
    assert.equal(binFromPrice(price, step), binId);
    if (binId > -10_000) assert.ok(priceFromBin(binId - 1, step) <= price);
  }
});

test("quotePerBaseX18 respects address order and token decimals", () => {
  const baseFirst = pairOrientation({
    baseAddress: "0x0000000000000000000000000000000000000001",
    quoteAddress: "0x0000000000000000000000000000000000000002",
    baseDecimals: 18,
    quoteDecimals: 6,
  });
  assert.equal(quotePerBaseX18(2_000_000n, baseFirst), 2_000_000_000_000_000_000n);
  const quoteFirst = pairOrientation({
    baseAddress: "0x0000000000000000000000000000000000000002",
    quoteAddress: "0x0000000000000000000000000000000000000001",
    baseDecimals: 18,
    quoteDecimals: 6,
  });
  assert.equal(quotePerBaseX18(500_000_000_000_000_000_000_000_000_000n, quoteFirst), 2_000_000_000_000_000_000n);
});

test("preview allocation conserves the full amount", () => {
  for (const shape of ["spot", "curve", "bid-ask"] as const) {
    const allocations = allocateByWeights(1_000_003n, liquidityShapeWeights(shape, 9));
    assert.equal(allocations.reduce((sum, value) => sum + value, 0n), 1_000_003n);
  }
});

test("uint256 overflow is rejected like the Solidity implementation", () => {
  assert.throws(() => priceFromBin(10_000, 1_000), /uint256/u);
});
