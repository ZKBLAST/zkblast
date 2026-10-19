import assert from "node:assert/strict";
import { test } from "node:test";

import { isNearlySquare } from "../src/components/markets/MarketPairLogo.js";

test("square logo detection keeps non-square artwork contained", () => {
  assert.equal(isNearlySquare(512, 512), true);
  assert.equal(isNearlySquare(1000, 920), true);
  assert.equal(isNearlySquare(1200, 630), false);
  assert.equal(isNearlySquare(0, 0), false);
});
