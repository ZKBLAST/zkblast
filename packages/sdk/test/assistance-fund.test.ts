import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAssistanceBuyback,
  previewAssistanceExecution,
  readAssistanceReconciliation,
} from "../src/assistance-fund.js";

const address = "0x1111111111111111111111111111111111111111";
const routeId = `0x${"22".repeat(32)}` as const;

test("previews a bounded buyback without claiming execution authority", () => {
  assert.deepEqual(
    previewAssistanceExecution({
      amountIn: 100n,
      quotedAmountOut: 200n,
      minimumAmount: 10n,
      maximumAmount: 1_000n,
      maximumSlippageBps: 100,
      enabled: true,
    }),
    {
      executable: true,
      amountIn: 100n,
      minimumAmountOut: 198n,
      reason: "ready",
    },
  );
});

test("prepares permissionless execution against the manifest executor", () => {
  const call = buildAssistanceBuyback({
    executor: address,
    routeId,
    amountIn: 100n,
    minimumAmountOut: 198n,
    deadline: 1_800_000_000n,
  });
  assert.equal(call.address, address);
  assert.equal(call.functionName, "executeBuyback");
  assert.deepEqual(call.args, [routeId, 100n, 198n, 1_800_000_000n]);
});

test("maps reconciliation fields without recomputing accounting", async () => {
  const client = {
    async readContract() {
      return [10_000n, 9_900n, 100n, 10_000n, 0n, true] as const;
    },
  };
  assert.deepEqual(
    await readAssistanceReconciliation(client, address, address),
    {
      balance: 10_000n,
      pendingBuyback: 9_900n,
      treasuryClaimable: 100n,
      liability: 10_000n,
      surplus: 0n,
      solvent: true,
    },
  );
});
