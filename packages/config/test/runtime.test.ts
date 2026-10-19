import assert from "node:assert/strict";
import { test } from "node:test";
import { loadServerConfig } from "../src/runtime.js";

const base = {
  CHAIN_NAME: "Robinhood Chain",
  RPC_URL: "https://rpc.example",
  BLOCK_EXPLORER_URL: "https://explorer.example",
  SUPABASE_URL: "https://database.example",
  SUPABASE_SERVICE_ROLE_KEY: "private",
};

test("accepts isolated testnet and mainnet runtime boundaries", () => {
  assert.equal(
    loadServerConfig({
      ...base,
      APP_ENV: "testnet",
      CHAIN_ID: 46_630,
      DEPLOYMENT_MANIFEST_PATH: "deployments/testnet/manifest.json",
      SUPABASE_SCHEMA: "zkblast_testnet",
    }).CHAIN_ID,
    46_630,
  );
  assert.equal(
    loadServerConfig({
      ...base,
      APP_ENV: "mainnet",
      CHAIN_ID: 4_663,
      DEPLOYMENT_MANIFEST_PATH: "deployments/mainnet/manifest.json",
      SUPABASE_SCHEMA: "zkblast_mainnet",
    }).CHAIN_ID,
    4_663,
  );
});

test("rejects cross-wired environment, chain, schema, and manifest", () => {
  assert.throws(() =>
    loadServerConfig({
      ...base,
      APP_ENV: "mainnet",
      CHAIN_ID: 46_630,
      DEPLOYMENT_MANIFEST_PATH: "deployments/testnet/manifest.json",
      SUPABASE_SCHEMA: "zkblast_testnet",
    }),
  );
});
