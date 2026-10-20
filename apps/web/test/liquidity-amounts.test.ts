import assert from "node:assert/strict";
import test from "node:test";
import { integerSqrt, liquidityAmounts } from "../src/lib/liquidity-amounts";

const input = {
  amount: "2000",
  seedAmount: "8000",
  decimals0: 0,
  decimals1: 0,
  slippageBps: 100,
  minimumLockedLiquidity: "1000",
  state: { reserve0: "0", reserve1: "0", totalShares: "0" },
};

test("initial liquidity deducts the live minimum locked shares", () => {
  assert.deepEqual(liquidityAmounts(input), {
    amount0: 2000n,
    amount1: 8000n,
    minimumShares: 2970n,
  });
  assert.equal(integerSqrt(15n), 3n);
  assert.equal(
    liquidityAmounts({ ...input, minimumLockedLiquidity: undefined }),
    null,
  );
});

test("funded liquidity preserves reserve proportions and rejects dust", () => {
  assert.deepEqual(
    liquidityAmounts({
      ...input,
      state: { reserve0: "4000", reserve1: "8000", totalShares: "2000" },
    }),
    { amount0: 2000n, amount1: 4000n, minimumShares: 990n },
  );
  assert.equal(
    liquidityAmounts({ ...input, amount: "1", seedAmount: "1" }),
    null,
  );
  assert.equal(liquidityAmounts({ ...input, amount: "1.1" }), null);
  assert.equal(liquidityAmounts({ ...input, slippageBps: 10000 }), null);
});
