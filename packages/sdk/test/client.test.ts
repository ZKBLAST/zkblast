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
  assert.equal(client.capabilities.launchpad, false);
  assert.equal(Object.isFrozen(client), true);
  await client.assertPublicChain();
  await client.assertWalletChain();
  assert.throws(() => client.requireCapability("launchpad"));
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
