import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePublicConfig } from "../src/lib/network-config.js";

const config = {
  chainName: "Robinhood Chain",
  explorerUrl: "https://explorer.example",
};

test("accepts the API-selected testnet and mainnet networks", () => {
  assert.equal(
    parsePublicConfig({ ...config, environment: "testnet", chainId: 46_630 })
      .chainId,
    46_630,
  );
  assert.equal(
    parsePublicConfig({ ...config, environment: "mainnet", chainId: 4_663 })
      .chainId,
    4_663,
  );
});

test("rejects a cross-wired API before wallet interaction", () => {
  assert.throws(
    () =>
      parsePublicConfig({
        ...config,
        environment: "mainnet",
        chainId: 46_630,
      }),
    /NETWORK_ENVIRONMENT_MISMATCH/u,
  );
});
