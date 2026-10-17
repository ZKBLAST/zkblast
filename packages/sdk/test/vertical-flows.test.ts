import assert from "node:assert/strict";
import test from "node:test";

import type { Address } from "viem";

import {
  buildApproval,
  buildCreateDammPosition,
  buildCreateDlmmPosition,
  buildDammSwap,
  buildDlmmSwap,
  deadlineFromNow,
  minimumAmountOut,
  quoteDammExactInput,
  quoteDlmmExactInput,
} from "../src/index.js";

const address = (suffix: string) => `0x${suffix.padStart(40, "0")}` as Address;
const router = address("1");
const quoter = address("2");
const manager = address("3");
const pool = address("4");
const token = address("5");
const user = address("6");
const deadline = deadlineFromNow(1_700_000_000, 1_200);

test("DAMM quote-to-swap and liquidity flow is typed and slippage-safe", async () => {
  const quote = await quoteDammExactInput(
    { readContract: async () => [980n, 3n] },
    quoter,
    pool,
    token,
    1_000n,
  );
  const approval = buildApproval(token, router, 1_000n);
  const swap = buildDammSwap({
    router,
    pool,
    tokenIn: token,
    amountIn: 1_000n,
    minimumAmountOut: minimumAmountOut(quote.amountOut, 50),
    recipient: user,
    deadline,
  });
  const position = buildCreateDammPosition({
    manager,
    pool,
    amount0: 500n,
    amount1: 490n,
    minimumShares: 475n,
    deadline,
  });

  assert.equal(quote.feeAmount, 3n);
  assert.equal(approval.functionName, "approve");
  assert.equal(swap.functionName, "swapDammExactInput");
  assert.equal(swap.args[3], 975n);
  assert.equal(position.functionName, "createDammPosition");
});

test("DLMM quote-to-swap and bin-position flow preserves traversal controls", async () => {
  const quote = await quoteDlmmExactInput(
    { readContract: async () => [1_250n, -2, 3] },
    quoter,
    pool,
    true,
    1_000n,
    8,
  );
  const swap = buildDlmmSwap({
    router,
    pool,
    token0ToToken1: true,
    amountIn: 1_000n,
    minimumAmountOut: minimumAmountOut(quote.amountOut, 100),
    maximumBinCrossings: 8,
    recipient: user,
    deadline,
  });
  const position = buildCreateDlmmPosition({
    manager,
    pool,
    binId: quote.finalBin,
    amount0: 500n,
    amount1: 500n,
    minimumShares: 450n,
    deadline,
  });

  assert.deepEqual(quote, { amountOut: 1_250n, finalBin: -2, binsCrossed: 3 });
  assert.equal(swap.functionName, "swapDlmmExactInput");
  assert.equal(swap.args[4], 8);
  assert.equal(position.args[1], -2);
});
