import assert from "node:assert/strict";
import test from "node:test";
import type { PublicClient } from "viem";
import { privateV2Synchronizer } from "../src/private-v2-sync.js";

const input = {
  client: {} as PublicClient,
  databaseUrl: "postgres://unused.invalid/database",
  schema: "zkblast_mainnet",
  chainId: 4663,
  registry: "0x0000000000000000000000000000000000001000" as const,
  vault: "0x0000000000000000000000000000000000002000" as const,
  deploymentBlock: 100,
  confirmations: 5n,
  chunkSize: 2000n,
  maximumBlocks: 10000n,
};
test("v2 indexer rejects crossed network/schema and unverified mainnet before opening a database", () => {
  assert.throws(
    () => privateV2Synchronizer({ ...input, schema: "zkblast_testnet" }),
    /NETWORK_SCHEMA/u,
  );
  assert.throws(() => privateV2Synchronizer(input), /VERIFIED_DEPLOYMENT/u);
});
