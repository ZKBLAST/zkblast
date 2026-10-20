import assert from "node:assert/strict";
import test from "node:test";
import {
  assertExecutionBudget,
  validatePonsFundingLimits,
} from "../scripts/pons-dlmm-budget.ts";

const limits = {
  purchaseWethRaw: "10000000000000",
  maximumUsdgRaw: "30000",
  slippageBps: 100,
  maxFeePerGasWei: "60312000",
  maxExecutionFeeWei: "400000000000000",
};
test("accepts owner-approved ceilings and smaller funding amounts", () => {
  validatePonsFundingLimits(limits);
  validatePonsFundingLimits({
    ...limits,
    purchaseWethRaw: "1",
    maximumUsdgRaw: "1",
    slippageBps: 1,
  });
});
test("rejects asset spend above either ceiling", () => {
  assert.throws(() =>
    validatePonsFundingLimits({ ...limits, purchaseWethRaw: "10000000000001" }),
  );
  assert.throws(() =>
    validatePonsFundingLimits({ ...limits, maximumUsdgRaw: "30001" }),
  );
});
test("rejects excessive or fractional slippage", () => {
  for (const slippageBps of [0, 101, 1.5, NaN])
    assert.throws(() => validatePonsFundingLimits({ ...limits, slippageBps }));
});
test("rejects malformed or zero asset amounts", () => {
  for (const purchaseWethRaw of ["-1", "0", "1.5", "1e13", ""])
    assert.throws(() =>
      validatePonsFundingLimits({ ...limits, purchaseWethRaw }),
    );
});
test("rejects raised gas and execution ceilings", () => {
  assert.throws(() =>
    validatePonsFundingLimits({ ...limits, maxFeePerGasWei: "60312001" }),
  );
  assert.throws(() =>
    validatePonsFundingLimits({
      ...limits,
      maxExecutionFeeWei: "400000000000001",
    }),
  );
});
test("execution budget accounts for previous receipts and reserves full stage gas", () => {
  assert.doesNotThrow(() => assertExecutionBudget(20n, 4n, 20n, 100n));
  assert.throws(() => assertExecutionBudget(21n, 4n, 20n, 100n));
  assert.throws(() => assertExecutionBudget(0n, 0n, 20n, 100n));
});
