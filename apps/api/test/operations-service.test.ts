import assert from "node:assert/strict";
import test from "node:test";
import type { Address } from "viem";
import { OperationsService } from "../src/operations-service.js";

const pool = "0x0000000000000000000000000000000000000001" as Address;

test("operations health activates every configured protocol alert", async () => {
  const service = new OperationsService(
    {
      readiness: async () => ({
        ready: false,
        rpcHead: "150",
        indexedBlock: "100",
        finalizedBlock: "100",
        lag: "50",
        checkpointUpdatedAt: "2026-10-17T00:00:00.000Z",
      }),
      recentFailedTransactions: async () => 4,
    } as never,
    { accounting: async () => ({ reconciled: false }) } as never,
    { readContract: async () => true },
    pool,
    {
      rpcLagBlocks: 25n,
      checkpointAgeSeconds: 120,
      recentTransactionFailures: 3,
    },
    () => new Date("2026-10-17T00:10:00.000Z"),
  );
  const result = await service.health();
  assert.equal(result.status, "alert");
  assert.deepEqual(
    result.alerts.filter((alert) => alert.active).map((alert) => alert.code),
    [
      "RPC_LAG",
      "INDEXING_DRIFT",
      "POOL_BALANCE_DEVIATION",
      "POOL_PAUSED",
      "TRANSACTION_FAILURE_RATE",
    ],
  );
});

test("operations health remains healthy inside thresholds", async () => {
  const service = new OperationsService(
    {
      readiness: async () => ({
        ready: true,
        rpcHead: "100",
        indexedBlock: "99",
        finalizedBlock: "99",
        lag: "1",
        checkpointUpdatedAt: "2026-10-17T00:09:30.000Z",
      }),
      recentFailedTransactions: async () => 0,
    } as never,
    { accounting: async () => ({ reconciled: true }) } as never,
    { readContract: async () => false },
    pool,
    {
      rpcLagBlocks: 25n,
      checkpointAgeSeconds: 120,
      recentTransactionFailures: 3,
    },
    () => new Date("2026-10-17T00:10:00.000Z"),
  );
  const result = await service.health();
  assert.equal(result.status, "healthy");
  assert.equal(
    result.alerts.some((alert) => alert.active),
    false,
  );
});
