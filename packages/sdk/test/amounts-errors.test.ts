import assert from "node:assert/strict";
import test from "node:test";

import {
  formatTokenAmount,
  maximumAmountIn,
  minimumAmountOut,
  normalizeTransactionError,
  parseTokenAmount,
} from "../src/index.js";

test("token units and rounding rules are centralized", () => {
  assert.equal(parseTokenAmount("1.25", 6), 1_250_000n);
  assert.equal(formatTokenAmount(1_250_000n, 6), "1.25");
  assert.equal(minimumAmountOut(101n, 100), 99n);
  assert.equal(maximumAmountIn(101n, 100), 103n);
});

test("transaction errors have stable application codes", () => {
  assert.equal(
    normalizeTransactionError(new Error("User rejected request")).code,
    "USER_REJECTED",
  );
  assert.equal(
    normalizeTransactionError(new Error("execution reverted")).code,
    "CONTRACT_REVERTED",
  );
});
