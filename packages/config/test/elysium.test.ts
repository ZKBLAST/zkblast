import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ELYSIUM_TESTNET_BRIDGE_URL,
  assertElysiumAssetIdentity,
  elysiumCanonicalAssets,
  getElysiumCanonicalAsset,
} from "../src/elysium.js";

test("authenticates Elysium assets by chain and address, never symbol alone", () => {
  const usdc = getElysiumCanonicalAsset(
    99_801,
    "0x7d29d8047b905000459c0e80c34a26ceedcb47b2",
  );
  assert.equal(usdc.symbol, "USDC");
  assert.equal(usdc.decimals, 6);
  assert.equal(usdc.quoteAsset, false);
  assert.equal(elysiumCanonicalAssets.length, 2);
  assert.throws(
    () =>
      getElysiumCanonicalAsset(
        999,
        "0x7D29d8047B905000459c0E80c34a26CeedcB47b2",
      ),
    /CHAIN_MISMATCH/u,
  );
  assert.throws(
    () =>
      getElysiumCanonicalAsset(
        99_801,
        "0x1111111111111111111111111111111111111111",
      ),
    /UNSUPPORTED/u,
  );
});

test("rejects deceptive metadata for a canonical address", () => {
  assert.throws(
    () =>
      assertElysiumAssetIdentity({
        chainId: 99_801,
        address: "0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F234",
        symbol: "USDC",
        decimals: 6,
      }),
    /IDENTITY_MISMATCH/u,
  );
  assert.equal(
    assertElysiumAssetIdentity({
      chainId: 99_801,
      address: "0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F234",
      symbol: "WHYPE",
      decimals: 18,
    }).symbol,
    "WHYPE",
  );
  assert.equal(
    ELYSIUM_TESTNET_BRIDGE_URL,
    "https://testnet.elysium.kinetiq.xyz/bridge",
  );
});
