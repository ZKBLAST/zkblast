import assert from "node:assert/strict";
import { test } from "node:test";
import { createZKBlastClient } from "../src/client.js";

test("creates an immutable client from the canonical chain registry", async () => {
  const client = createZKBlastClient({
    chainId: 999,
    publicClient: { getChainId: async () => 999 },
    walletClient: { getChainId: async () => 999 },
  });
  assert.equal(client.chain.slug, "hyperevm-mainnet");
  assert.equal(client.capabilities.launchpad, true);
  assert.equal(Object.isFrozen(client), true);
  await client.assertPublicChain();
  await client.assertWalletChain();
  assert.doesNotThrow(() => client.requireCapability("launchpad"));
});

test("rejects public and wallet clients connected to another chain", async () => {
  const client = createZKBlastClient({
    chainId: 998,
    publicClient: { getChainId: async () => 46630 },
    walletClient: { getChainId: async () => 999 },
  });
  await assert.rejects(client.assertPublicChain, /does not match/u);
  await assert.rejects(client.assertWalletChain, /does not match/u);
});

test("returns no fabricated explorer link for HyperEVM testnet", () => {
  const client = createZKBlastClient({
    chainId: 998,
    publicClient: { getChainId: async () => 998 },
  });
  assert.equal(
    client.explorerAddressUrl("0x1111111111111111111111111111111111111111"),
    null,
  );
});

test("creates a fail-closed Elysium client from generated bindings and canonical config", async () => {
  const client = createZKBlastClient({
    chainId: 99_801,
    publicClient: { getChainId: async () => 99_801 },
    walletClient: { getChainId: async () => 99_801 },
  });
  assert.equal(client.chain.slug, "elysium-testnet");
  assert.equal(client.chain.family, "elysium");
  assert.equal(client.chain.nativeCurrency.symbol, "HYPE");
  assert.equal(client.manifest, null);
  assert.equal(client.dbc, null);
  assert.equal(client.launchpad, null);
  assert.throws(
    () => client.requireCapability("launchpad"),
    /disabled on elysium-testnet/u,
  );
  assert.equal(
    client.explorerTransactionUrl(`0x${"a".repeat(64)}`),
    `https://elysium.kinetiq.xyz/testnet-explorer/tx/0x${"a".repeat(64)}`,
  );
  await client.assertPublicChain();
  await client.assertWalletChain();
});
