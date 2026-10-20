import assert from "node:assert/strict";
import test from "node:test";
import { binPriceX18, initialBinForPrice } from "../src/pool-creation.js";

test("DLMM bin prices use fixed-point positive and reciprocal negative bins", () => {
  assert.equal(binPriceX18(0, 10), 10n ** 18n);
  assert.equal(binPriceX18(1, 10), 1001000000000000000n);
  assert.equal(binPriceX18(-1, 10), 10n ** 36n / 1001000000000000000n);
});

test("initial price accounts for canonical direction and token decimals", () => {
  assert.equal(initialBinForPrice("1", 18, 18, true, 10).bin, 0);
  const forward = initialBinForPrice("2", 18, 18, true, 10);
  const reverse = initialBinForPrice("0.5", 18, 18, false, 10);
  assert.deepEqual(forward, reverse);
  assert.equal(initialBinForPrice("1", 18, 6, true, 100).bin, -2777);
});

test("unrepresentable prices and invalid bins are rejected", () => {
  assert.throws(() => initialBinForPrice("0", 18, 18, true, 10));
  assert.throws(() => initialBinForPrice("1", 18, 6, true, 1));
  assert.throws(() => binPriceX18(10001, 10));
  assert.throws(() => binPriceX18(0, 0));
});
