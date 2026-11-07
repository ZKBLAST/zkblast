import assert from "node:assert/strict";
import { test } from "node:test";
import {
  loadServerConfig,
  resolveServerRpcSelection,
} from "../src/runtime.js";

const base = {
  RPC_URL: "https://rpc.example",
  SUPABASE_URL: "https://database.example",
  SUPABASE_SERVICE_ROLE_KEY: "private",
};

test("accepts isolated testnet and mainnet runtime boundaries", () => {
  assert.equal(
    loadServerConfig({
      ...base,
      APP_ENV: "testnet",
      CHAIN_ID: 46_630,
      CHAIN_NAME: "Robinhood Chain Testnet",
      BLOCK_EXPLORER_URL: "https://explorer.testnet.chain.robinhood.com",
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
      CHAIN_NAME: "Robinhood Chain",
      BLOCK_EXPLORER_URL: "https://robinhoodchain.blockscout.com",
      DEPLOYMENT_MANIFEST_PATH: "deployments/mainnet/manifest.json",
      SUPABASE_SCHEMA: "zkblast_mainnet",
    }).CHAIN_ID,
    4_663,
  );
});

test("accepts isolated HyperEVM runtime boundaries with disabled capabilities", () => {
  assert.equal(
    loadServerConfig({
      ...base,
      APP_ENV: "testnet",
      CHAIN_ID: 998,
      CHAIN_NAME: "HyperEVM Testnet",
      BLOCK_EXPLORER_URL: "",
      DEPLOYMENT_MANIFEST_PATH: "deployments/hyperevm-testnet/manifest.json",
      SUPABASE_SCHEMA: "zkblast_hyperevm_testnet",
    }).CHAIN_ID,
    998,
  );
  assert.equal(
    loadServerConfig({
      ...base,
      APP_ENV: "mainnet",
      CHAIN_ID: 999,
      CHAIN_NAME: "HyperEVM",
      BLOCK_EXPLORER_URL: "https://www.hyperscan.com",
      DEPLOYMENT_MANIFEST_PATH: "deployments/hyperevm-mainnet/manifest.json",
      SUPABASE_SCHEMA: "zkblast_hyperevm_mainnet",
    }).CHAIN_ID,
    999,
  );
});

test("accepts isolated Elysium testnet runtime with server-only provider fallback", () => {
  const config = loadServerConfig({
    ...base,
    APP_ENV: "testnet",
    CHAIN_ID: 99_801,
    CHAIN_NAME: "Elysium Testnet",
    RPC_URL: "https://testnet-rpc.elysium.kinetiq.xyz",
    ELYSIUM_PRIVATE_RPC_URL: "https://elysium-provider.example/v2/private",
    ELYSIUM_WS_RPC_URL: "wss://elysium-provider.example/v2/private",
    BLOCK_EXPLORER_URL: "https://elysium.kinetiq.xyz/testnet-explorer",
    DEPLOYMENT_MANIFEST_PATH: "deployments/elysium-testnet/manifest.json",
    SUPABASE_SCHEMA: "zkblast_elysium_testnet",
  });
  assert.deepEqual(resolveServerRpcSelection(config), {
    httpUrl: "https://elysium-provider.example/v2/private",
    websocketUrl: "wss://elysium-provider.example/v2/private",
    usesPrivateProvider: true,
  });
});

test("rejects Elysium schema, manifest, provider, and integration crossover", () => {
  const elysium = {
    ...base,
    APP_ENV: "testnet",
    CHAIN_ID: 99_801,
    CHAIN_NAME: "Elysium Testnet",
    RPC_URL: "https://testnet-rpc.elysium.kinetiq.xyz",
    BLOCK_EXPLORER_URL: "https://elysium.kinetiq.xyz/testnet-explorer",
    DEPLOYMENT_MANIFEST_PATH: "deployments/elysium-testnet/manifest.json",
    SUPABASE_SCHEMA: "zkblast_elysium_testnet",
  } as const;
  assert.throws(
    () => loadServerConfig({ ...elysium, SUPABASE_SCHEMA: "zkblast_hyperevm_testnet" }),
    /database schema/u,
  );
  assert.throws(
    () => loadServerConfig({ ...elysium, DEPLOYMENT_MANIFEST_PATH: "deployments/testnet/manifest.json" }),
    /requires manifest/u,
  );
  assert.throws(
    () => loadServerConfig({ ...elysium, RPC_URL: "https://unapproved.example" }),
    /approved public fallback/u,
  );
  assert.throws(
    () => loadServerConfig({ ...elysium, GRADUATION_POOL_FACTORY_ADDRESS: "0x5555555555555555555555555555555555555555" }),
    /graduation integrations are disabled/u,
  );
  assert.doesNotThrow(() =>
    loadServerConfig({
      ...elysium,
      EXECUTION_RESERVE_ASSET_ADDRESS:
        "0x7D29d8047B905000459c0E80c34a26CeedcB47b2",
    }),
  );
});

test("does not allow Elysium provider variables on another chain", () => {
  assert.throws(
    () =>
      loadServerConfig({
        ...base,
        APP_ENV: "mainnet",
        CHAIN_ID: 4_663,
        CHAIN_NAME: "Robinhood Chain",
        BLOCK_EXPLORER_URL: "https://robinhoodchain.blockscout.com",
        DEPLOYMENT_MANIFEST_PATH: "deployments/mainnet/manifest.json",
        SUPABASE_SCHEMA: "zkblast_mainnet",
        ELYSIUM_PRIVATE_RPC_URL: "https://elysium-provider.example/private",
      }),
    /cannot use Elysium provider/u,
  );
});

test("rejects cross-wired environment, chain, schema, and manifest", () => {
  assert.throws(() =>
    loadServerConfig({
      ...base,
      APP_ENV: "mainnet",
      CHAIN_ID: 46_630,
      CHAIN_NAME: "Robinhood Chain Testnet",
      BLOCK_EXPLORER_URL: "https://explorer.testnet.chain.robinhood.com",
      DEPLOYMENT_MANIFEST_PATH: "deployments/testnet/manifest.json",
      SUPABASE_SCHEMA: "zkblast_testnet",
    }),
  );
  assert.throws(() =>
    loadServerConfig({
      ...base,
      APP_ENV: "testnet",
      CHAIN_ID: 998,
      CHAIN_NAME: "HyperEVM Testnet",
      BLOCK_EXPLORER_URL: "",
      DEPLOYMENT_MANIFEST_PATH: "deployments/testnet/manifest.json",
      SUPABASE_SCHEMA: "zkblast_testnet",
    }),
  );
});

test("rejects unvalidated testnet explorer and permits approved mainnet integration addresses", () => {
  assert.throws(
    () =>
      loadServerConfig({
        ...base,
        APP_ENV: "testnet",
        CHAIN_ID: 998,
        CHAIN_NAME: "HyperEVM Testnet",
        BLOCK_EXPLORER_URL: "https://testnet-explorer.example",
        DEPLOYMENT_MANIFEST_PATH:
          "deployments/hyperevm-testnet/manifest.json",
        SUPABASE_SCHEMA: "zkblast_hyperevm_testnet",
      }),
    /does not have a validated explorer URL/u,
  );

  const mainnet = loadServerConfig({
    ...base,
    APP_ENV: "mainnet",
    CHAIN_ID: 999,
    CHAIN_NAME: "HyperEVM",
    BLOCK_EXPLORER_URL: "https://www.hyperscan.com",
    DEPLOYMENT_MANIFEST_PATH:
      "deployments/hyperevm-mainnet/manifest.json",
    SUPABASE_SCHEMA: "zkblast_hyperevm_mainnet",
    EXECUTION_RESERVE_ASSET_ADDRESS:
      "0x5555555555555555555555555555555555555555",
  });
  assert.equal(mainnet.CHAIN_ID, 999);
});
