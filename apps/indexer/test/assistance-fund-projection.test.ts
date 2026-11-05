import assert from "node:assert/strict";
import test from "node:test";
import type { IndexedEvent } from "../src/domain.js";
import {
  assistanceReconciliationIssues,
  projectAssistanceFundEvent,
} from "../src/assistance-fund-projection.js";

const hash = `0x${"11".repeat(32)}` as const;
const address = `0x${"22".repeat(20)}` as const;
const event = (
  eventName: string,
  payload: IndexedEvent["payload"],
): IndexedEvent => ({
  chainId: 4663,
  blockNumber: 10n,
  blockHash: hash,
  transactionHash: hash,
  logIndex: 1,
  contractAddress: address,
  kind: "fee",
  eventName,
  payload,
});

test("projects exact revenue and allocation receipts", () => {
  const revenue = projectAssistanceFundEvent(
    event("ProtocolRevenueRecorded", {
      sourceId: hash,
      epochId: hash,
      asset: address,
      kind: 0,
      grossAmount: "10000",
      excludedObligations: "0",
      eligibleAmount: "10000",
    }),
  );
  assert.equal(revenue?.kind, "revenue");
  const allocation = projectAssistanceFundEvent(
    event("ProtocolFeeAllocated", {
      sourceId: hash,
      epochId: hash,
      asset: address,
      eligibleAmount: "10000",
      buybackAmount: "9900",
      treasuryAmount: "100",
    }),
  );
  assert.equal(allocation?.kind, "allocation");
});

test("rejects an offchain-recomputed or inconsistent allocation", () => {
  assert.equal(
    projectAssistanceFundEvent(
      event("ProtocolFeeAllocated", {
        sourceId: hash,
        epochId: hash,
        asset: address,
        eligibleAmount: "10000",
        buybackAmount: "9800",
        treasuryAmount: "100",
      }),
    ),
    null,
  );
});

test("projects burn supply delta in original token units", () => {
  const burn = projectAssistanceFundEvent(
    event("ProtocolTokensBurned", {
      protocolToken: address,
      method: 0,
      amount: "200",
      totalSupplyBefore: "1000",
      totalSupplyAfter: "800",
      executor: address,
    }),
  );
  assert.equal(burn?.kind, "burn");
  if (burn?.kind === "burn") assert.equal(burn.amountRaw, 200n);
});

test("reports reconciliation drift in original token units", () => {
  assert.deepEqual(
    assistanceReconciliationIssues({
      balanceRaw: 9_999n,
      pendingBuybackRaw: 9_900n,
      treasuryClaimableRaw: 100n,
      liabilityRaw: 10_000n,
      surplusRaw: 0n,
      solvent: false,
    }),
    ["BALANCE_MISMATCH", "INSOLVENT"],
  );
});
