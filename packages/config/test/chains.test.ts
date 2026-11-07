import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getChainDescriptor,
  isSupportedDatabaseSchema,
  isSupportedChainId,
  supportedChains,
} from "../src/chains.js";

test("exposes isolated Robinhood, HyperEVM, and Elysium chain descriptors", () => {
  assert.deepEqual(
    supportedChains.map((chain) => chain.chainId),
    [46_630, 4_663, 99_801, 998, 999],
  );
  assert.equal(getChainDescriptor(998).family, "hyperevm");
  assert.equal(getChainDescriptor(998).nativeCurrency.symbol, "HYPE");
  assert.equal(getChainDescriptor(999).capabilities.launchpad, true);
  assert.equal(getChainDescriptor(999).capabilities.dbc, true);
  assert.equal(getChainDescriptor(999).capabilities.dammGraduation, true);
  assert.equal(getChainDescriptor(999).capabilities.dlmmGraduation, false);
  assert.equal(getChainDescriptor(999).capabilities.metadataUpload, true);
  assert.equal(getChainDescriptor(998).capabilities.metadataUpload, false);
  assert.equal(getChainDescriptor(998).execution.fastBlockGasLimit, 2_000_000);
  assert.equal(getChainDescriptor(998).indexer.maximumLogRange, 50);
  assert.equal(getChainDescriptor(999).execution.maximumQueuedNonces, 8);
  assert.equal(getChainDescriptor(999).indexer.officialWebsocket, false);
  assert.equal(getChainDescriptor(4_663).databaseSchema, "zkblast_mainnet");
  const elysium = getChainDescriptor(99_801);
  assert.equal(elysium.family, "elysium");
  assert.equal(elysium.environment, "testnet");
  assert.equal(elysium.databaseSchema, "zkblast_elysium_testnet");
  assert.equal(elysium.deploymentManifestPath, "deployments/elysium-testnet/manifest.json");
  assert.equal(elysium.indexer.maximumLogRange, 2_000);
  assert.deepEqual(elysium.publicRpcUrls, ["https://testnet-rpc.elysium.kinetiq.xyz"]);
  assert.equal(elysium.capabilities.dbc, true);
  assert.equal(elysium.capabilities.launchpad, true);
  assert.equal(elysium.capabilities.protectedLaunch, true);
  assert.equal(elysium.capabilities.metadataUpload, true);
  assert.equal(elysium.capabilities.dammGraduation, false);
  assert.equal(elysium.capabilities.dlmmGraduation, false);
});

test("recognizes only canonical isolated database schemas", () => {
  assert.equal(isSupportedDatabaseSchema("zkblast_mainnet"), true);
  assert.equal(isSupportedDatabaseSchema("zkblast_hyperevm_testnet"), true);
  assert.equal(isSupportedDatabaseSchema("zkblast_elysium_testnet"), true);
  assert.equal(isSupportedDatabaseSchema("public"), false);
  assert.equal(isSupportedDatabaseSchema("zkblast_hyperevm_mainnet;drop"), false);
});

test("rejects unknown or malformed chain identifiers", () => {
  assert.equal(isSupportedChainId(999), true);
  assert.equal(isSupportedChainId(1), false);
  assert.throws(() => getChainDescriptor(1), /CHAIN_ID_UNSUPPORTED/u);
  assert.throws(() => getChainDescriptor(0), /CHAIN_ID_INVALID/u);
});
