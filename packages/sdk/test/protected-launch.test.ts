import assert from "node:assert/strict";
import test from "node:test";

import {
  ProtectedLaunchClient,
  assertProtectedLaunchCapability,
  protectionBlocksForDuration,
  simulateProtectedBuy,
  type ProtectedLaunchAddresses,
} from "../src/protected-launch.js";

test("derives Elysium protection windows from measured cadence", () => {
  assert.equal(
    protectionBlocksForDuration({
      durationSeconds: 60,
      measuredBlockMilliseconds: 100,
    }),
    600,
  );
  assert.equal(
    protectionBlocksForDuration({
      durationSeconds: 1,
      measuredBlockMilliseconds: 125,
    }),
    8,
  );
  assert.throws(() =>
    protectionBlocksForDuration({
      durationSeconds: 60,
      measuredBlockMilliseconds: 100,
      maximumBlocks: 500,
    }),
  );
  assert.throws(() =>
    protectionBlocksForDuration({
      durationSeconds: 60,
      measuredBlockMilliseconds: 0,
    }),
  );
});

const addresses: ProtectedLaunchAddresses = {
  chainId: 4663,
  policyRegistry: "0x0000000000000000000000000000000000000001",
  launchFactory: "0x0000000000000000000000000000000000000002",
  launchRouter: "0x0000000000000000000000000000000000000003",
  lpEscrow: "0x0000000000000000000000000000000000000004",
  graduationManager: "0x0000000000000000000000000000000000000005",
  identityRegistry: "0x0000000000000000000000000000000000000006",
};

test("simulates transaction and cumulative address caps", () => {
  assert.deepEqual(
    simulateProtectedBuy({
      quotedBaseOutRaw: 25n,
      purchasedDuringProtectionRaw: 50n,
      maximumPerTransactionRaw: 25n,
      maximumPerAddressRaw: 100n,
    }),
    { allowed: true, remainingAddressAllocationRaw: 25n },
  );
  assert.equal(
    simulateProtectedBuy({
      quotedBaseOutRaw: 26n,
      purchasedDuringProtectionRaw: 0n,
      maximumPerTransactionRaw: 25n,
      maximumPerAddressRaw: 100n,
    }).reason,
    "TRANSACTION_CAP",
  );
  assert.equal(
    simulateProtectedBuy({
      quotedBaseOutRaw: 25n,
      purchasedDuringProtectionRaw: 90n,
      maximumPerTransactionRaw: 25n,
      maximumPerAddressRaw: 100n,
    }).reason,
    "ADDRESS_CAP",
  );
});

test("prepares canonical protected launch call", () => {
  const client = new ProtectedLaunchClient(addresses);
  const call = client.createProtectedLaunch({
    templateId: 1n,
    policyId: 2n,
    salt: `0x${"11".repeat(32)}`,
    deadline: 1_900_000_000n,
    name: "Protected Token",
    symbol: "PRT",
    metadataUri: "ipfs://protected",
    creatorTokenRecipient: "0x0000000000000000000000000000000000000007",
  });
  assert.equal(call.functionName, "createLaunch");
  assert.equal(call.address, addresses.launchFactory);
});

test("builds lock, risk and graduation readers", () => {
  const client = new ProtectedLaunchClient(addresses);
  const migrationId = `0x${"22".repeat(32)}` as const;
  const launchId = `0x${"33".repeat(32)}` as const;
  const pool = "0x0000000000000000000000000000000000000008" as const;

  assert.equal(client.liquidityLock(migrationId).functionName, "getAllocation");
  assert.equal(client.identityRisk(launchId).functionName, "identity");
  const graduation = client.graduationState(pool, migrationId);
  assert.equal(graduation.pool.functionName, "graduationState");
  assert.equal(graduation.attempt.functionName, "migrationAttemptState");
  assert.equal(graduation.context.functionName, "migrationContext");
  assert.equal(
    graduation.accountingReconciles.functionName,
    "accountingReconciles",
  );
});

test("prepares protected router buy and sell calls", () => {
  const client = new ProtectedLaunchClient(addresses);
  const pool = "0x0000000000000000000000000000000000000007";
  const user = "0x0000000000000000000000000000000000000008";
  assert.equal(client.buyExactInput({
    pool,grossQuoteInRaw:100n,minimumBaseOutRaw:90n,maximumPriceX18:2n,recipient:user,deadline:10n,
  }).address, addresses.launchRouter);
  assert.equal(client.sellExactInput({
    pool,baseInRaw:10n,minimumQuoteOutRaw:9n,minimumPriceX18:1n,recipient:user,deadline:10n,
  }).functionName, "sellExactInput");
});

test("rejects a mismatched chain", () => {
  assert.throws(() => assertProtectedLaunchCapability(addresses, 999));
  assert.doesNotThrow(() => assertProtectedLaunchCapability(addresses, 4663));
});
