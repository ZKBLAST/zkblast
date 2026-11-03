import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePublicConfig } from "../src/lib/network-config.js";
import { getChainDescriptor } from "@zkblast/config";

const configFor = (chainId: number) => {
  const chain = getChainDescriptor(chainId);
  return {
    environment: chain.environment,
    chainId,
    chainName: chain.name,
    explorerUrl: chain.explorerUrl ?? "",
    capabilities: chain.capabilities,
  };
};

test("accepts the API-selected testnet and mainnet networks", () => {
  assert.equal(
    parsePublicConfig(configFor(46_630)).chainId,
    46_630,
  );
  assert.equal(
    parsePublicConfig(configFor(4_663)).chainId,
    4_663,
  );
});

test("rejects a cross-wired API before wallet interaction", () => {
  assert.throws(
    () =>
      parsePublicConfig({
        ...configFor(46_630),
        environment: "mainnet",
      }),
    /NETWORK_ENVIRONMENT_MISMATCH/u,
  );
});
