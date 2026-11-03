import assert from "node:assert/strict";
import test from "node:test";
import type { IndexedEvent } from "../src/domain.js";
import { protectedProjectionFromEvent } from "../src/protected-launch-projection.js";

const event = (eventName: string, payload: IndexedEvent["payload"]): IndexedEvent => ({
  chainId: 4663,
  blockNumber: 100n,
  blockHash: `0x${"11".repeat(32)}`,
  transactionHash: `0x${"22".repeat(32)}`,
  logIndex: 3,
  contractAddress: "0x0000000000000000000000000000000000000001",
  kind: "launch",
  eventName,
  payload,
});

test("projects canonical protected launch bindings", () => {
  const launchId = `0x${"33".repeat(32)}`;
  const projection = protectedProjectionFromEvent(
    event("ProtectedTokenLaunched", { launchId, policyId: "7" }),
  );
  assert.equal(projection?.kind, "launch");
  assert.equal(projection?.launchId, launchId);
  assert.equal(projection?.policyId, 7n);
});

test("normalizes protected buyer address", () => {
  const projection = protectedProjectionFromEvent(
    event("ProtectedPurchaseRecorded", {
      buyer: "0x00000000000000000000000000000000000000AA",
      amount: "1",
      cumulativeAmount: "1",
    }),
  );
  assert.equal(projection?.kind, "purchase");
  assert.equal(projection?.account, "0x00000000000000000000000000000000000000aa");
});

test("rejects incomplete migration projections", () => {
  assert.throws(() =>
    protectedProjectionFromEvent(event("ProtectedAllocationRegistered", {})),
  );
});
