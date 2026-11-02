import assert from "node:assert/strict";
import test from "node:test";
import type { LaunchpadAddresses } from "@zkblast/sdk";
import { LaunchpadCatalogService } from "../src/launchpad-catalog-service.js";

const address = (digit: string) => `0x${digit.repeat(40)}` as `0x${string}`;
const addresses: LaunchpadAddresses = {
  abiVersion: 1,
  registry: address("1"),
  configManager: address("2"),
  factory: address("3"),
  lens: address("4"),
  feeController: address("5"),
  revenueSplitter: address("6"),
  feeCollector: address("7"),
  tokenFactory: address("8"),
};

test("exposes public addresses and only enabled onchain presets", async () => {
  const service = new LaunchpadCatalogService("mainnet", 4663, addresses, {
    launchpadCount: async () => 1n,
    presetCount: async () => 2n,
    globalMaximumTotalTradeFeeBps: async () => 300,
    destinationSupported: async (destination) => destination === 1,
    launchpad: async () => ({
      owner: address("1"),
      pendingOwner: address("0"),
      treasury: address("2"),
      pendingTreasury: address("0"),
      operator: address("0"),
      metadataHash: `0x${"a".repeat(64)}`,
      slugCommitment: `0x${"b".repeat(64)}`,
      configPresetId: 1n,
      version: 1,
      status: 1,
      createdAt: 10n,
      updatedAt: 10n,
    }),
    launchpads: async () => [
      {
        owner: address("1"),
        pendingOwner: address("0"),
        treasury: address("2"),
        pendingTreasury: address("0"),
        operator: address("0"),
        metadataHash: `0x${"a".repeat(64)}`,
        slugCommitment: `0x${"b".repeat(64)}`,
        configPresetId: 1n,
        version: 1,
        status: 1,
        createdAt: 10n,
        updatedAt: 10n,
      },
    ],
    presets: async () => [
      {
        familyId: `0x${"a".repeat(64)}`,
        configHash: `0x${"b".repeat(64)}`,
        dbcTemplateId: 1n,
        quoteToken: address("9"),
        maximumTotalTradeFeeBps: 100,
        graduationDestination: 1,
        creatorAccess: 0,
        maximumLaunches: 100,
        version: 1,
        enabled: true,
        used: false,
      },
      {
        familyId: `0x${"c".repeat(64)}`,
        configHash: `0x${"d".repeat(64)}`,
        dbcTemplateId: 2n,
        quoteToken: address("9"),
        maximumTotalTradeFeeBps: 200,
        graduationDestination: 2,
        creatorAccess: 1,
        maximumLaunches: 10,
        version: 1,
        enabled: false,
        used: false,
      },
    ],
  });
  assert.equal(service.configuration().factory, addresses.factory);
  const result = await service.approvedPresets();
  assert.equal(result.globalFeeCapBps, 300);
  assert.deepEqual(result.capabilities, {
    dammGraduation: true,
    dlmmGraduation: false,
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.presetId, "1");
  assert.equal(result.items[0]?.maximumTotalTradeFeeBps, 100);
  assert.equal((await service.launchpad(1n)).owner, address("1"));
  assert.equal((await service.ownedLaunchpads(address("1"))).items.length, 1);
  assert.equal((await service.ownedLaunchpads(address("2"))).items.length, 0);
});
