import assert from "node:assert/strict";
import test from "node:test";

import {
  LaunchpadRevenueClient,
  launchpadRevenueKinds,
  launchpadRevenueLabels,
} from "../src/launchpad-revenue.js";

const splitter = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";
const asset = "0x3333333333333333333333333333333333333333";
const snapshot =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

test("prepares snapshot-scoped revenue reads and claim", () => {
  const client = new LaunchpadRevenueClient(splitter);
  assert.deepEqual(client.claimable(recipient, asset).args, [recipient, asset]);
  assert.deepEqual(client.claimableForSnapshot(snapshot, recipient).args, [
    snapshot,
    recipient,
  ]);
  assert.deepEqual(client.accrued(snapshot, launchpadRevenueKinds.poolFee).args, [
    snapshot,
    1,
  ]);
  assert.equal(client.claim(snapshot).functionName, "claim");
  assert.deepEqual(client.claim(snapshot).args, [snapshot]);
  assert.equal(client.reconciliation(asset).functionName, "reconciliation");
  assert.equal(launchpadRevenueLabels[launchpadRevenueKinds.tradeFee], "Trade fees");
  assert.equal(launchpadRevenueLabels[launchpadRevenueKinds.lpReward], "LP rewards");
});
