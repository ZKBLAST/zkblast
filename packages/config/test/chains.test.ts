import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getChainDescriptor,
  isSupportedDatabaseSchema,
  isSupportedChainId,
  supportedChains,
} from "../src/chains.js";

test("exposes isolated Robinhood and HyperEVM chain descriptors", () => {
  assert.deepEqual(
    supportedChains.map((chain) => chain.chainId),
    [46_630, 4_663, 998, 999],
  );
  assert.equal(getChainDescriptor(998).family, "hyperevm");
  assert.equal(getChainDescriptor(998).nativeCurrency.symbol, "HYPE");
  assert.equal(getChainDescriptor(999).capabilities.launchpad, true);
  assert.equal(getChainDescriptor(999).capabilities.dbc, true);
  assert.equal(getChainDescriptor(999).capabilities.dammGraduation, true);
  assert.equal(getChainDescriptor(999).capabilities.dlmmGraduation, false);
  assert.equal(getChainDescriptor(998).capabilities.metadataUpload, false);
  assert.equal(getChainDescriptor(998).execution.fastBlockGasLimit, 2_000_000);
  assert.equal(getChainDescriptor(998).indexer.maximumLogRange, 50);
  assert.equal(getChainDescriptor(999).execution.maximumQueuedNonces, 8);
  assert.equal(getChainDescriptor(999).indexer.officialWebsocket, false);
  assert.equal(getChainDescriptor(4_663).databaseSchema, "zkblast_mainnet");
});

test("recognizes only canonical isolated database schemas", () => {
  assert.equal(isSupportedDatabaseSchema("zkblast_mainnet"), true);
  assert.equal(isSupportedDatabaseSchema("zkblast_hyperevm_testnet"), true);
  assert.equal(isSupportedDatabaseSchema("public"), false);
  assert.equal(isSupportedDatabaseSchema("zkblast_hyperevm_mainnet;drop"), false);
});

test("rejects unknown or malformed chain identifiers", () => {
  assert.equal(isSupportedChainId(999), true);
  assert.equal(isSupportedChainId(1), false);
  assert.throws(() => getChainDescriptor(1), /CHAIN_ID_UNSUPPORTED/u);
  assert.throws(() => getChainDescriptor(0), /CHAIN_ID_INVALID/u);
});
