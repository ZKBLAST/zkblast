import assert from "node:assert/strict";
import test from "node:test";
import { linearCurvePreview } from "../src/dbc-math.js";

test("linear curve preview uses the canonical X18 price progression", () => {
  const points = linearCurvePreview(
    {
      initialPriceX18: 100_000_000_000_000_000n,
      slopeX18: 200_000_000_000_000_000n,
      saleCapacityX18: 1_000_000_000_000_000_000n,
    },
    3,
  );
  assert.deepEqual(points, [
    { progressBps: 0, priceX18: 100_000_000_000_000_000n },
    { progressBps: 5_000, priceX18: 200_000_000_000_000_000n },
    { progressBps: 10_000, priceX18: 300_000_000_000_000_000n },
  ]);
});
