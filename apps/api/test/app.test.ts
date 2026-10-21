import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";
import type { ExternalMarketService } from "../src/external-market-service.js";
import type { SwapService } from "../src/swap-service.js";

const app = createApp({
  environment: "testnet",
  chainId: 46_630,
  chainName: "Test Chain",
  explorerUrl: "https://explorer.example",
  webOrigin: "http://127.0.0.1:3000",
  contracts: [
    {
      name: "SwapRouter",
      proxyKind: "uups",
      address: "0x1111111111111111111111111111111111111111",
      proxyAddress: "0x1111111111111111111111111111111111111111",
      implementationAddress: "0x2222222222222222222222222222222222222222",
      verification: {
        implementation: "verified",
        proxy: "verified",
        urls: [
          "https://explorer.example/address/0x1111111111111111111111111111111111111111",
        ],
      },
    },
  ],
});

test("public config excludes internal connection details", async () => {
  const response = await request(app)
    .get("/v1/config")
    .set("origin", "http://127.0.0.1:3000");

  assert.equal(response.status, 200);
  assert.equal(
    response.headers["access-control-allow-origin"],
    "http://127.0.0.1:3000",
  );
  assert.equal(response.headers["access-control-allow-credentials"], "true");
  assert.equal(response.headers["x-powered-by"], undefined);
  assert.deepEqual(response.body, {
    environment: "testnet",
    chainId: 46_630,
    chainName: "Test Chain",
    explorerUrl: "https://explorer.example",
    contracts: [
      {
        name: "SwapRouter",
        proxyKind: "uups",
        address: "0x1111111111111111111111111111111111111111",
        proxyAddress: "0x1111111111111111111111111111111111111111",
        implementationAddress: "0x2222222222222222222222222222222222222222",
        verification: {
          implementation: "verified",
          proxy: "verified",
          urls: [
            "https://explorer.example/address/0x1111111111111111111111111111111111111111",
          ],
        },
      },
    ],
  });
});

test("mainnet v2 public config exposes only network-bound deployment metadata", async () => {
  const hash = `0x${"a".repeat(64)}`;
  const v2 = {
    vault: "0x1111111111111111111111111111111111111111",
    fieldHasher: "0x2222222222222222222222222222222222222222",
    treeVersion: 2,
    deploymentBlock: 100,
    proverRelease: {
      manifestPath: "/zk/mainnet/v2/release.json",
      manifestSha256: "a".repeat(64),
    },
    verifiedDeployment: {
      chainId: 4663 as const,
      transactionHash: hash,
      verifiedBlock: 105,
      implementation: "0x3333333333333333333333333333333333333333",
      proxyRuntimeHash: hash,
      implementationRuntimeHash: hash,
      fieldHasherRuntimeHash: hash,
      actionAdapterRuntimeHash: hash,
      fundAdapterRuntimeHash: hash,
      actionGroth16RuntimeHash: hash,
      fundGroth16RuntimeHash: hash,
    },
  };
  const config = {
    environment: "mainnet" as const,
    chainId: 4663,
    chainName: "Mainnet",
    explorerUrl: "https://explorer.example",
    webOrigin: "http://localhost:3000",
    contracts: [],
    shieldedV2: v2,
  };
  const response = await request(createApp(config)).get("/v1/config");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.shieldedV2, v2);
  assert.deepEqual(
    Object.keys(response.body).sort(),
    [
      "chainId",
      "chainName",
      "contracts",
      "environment",
      "explorerUrl",
      "shieldedV2",
    ].sort(),
  );
  const wrong = await request(
    createApp({
      ...config,
      shieldedV2: {
        ...v2,
        proverRelease: {
          ...v2.proverRelease,
          manifestPath: "/zk/testnet/v2/release.json",
        },
      },
    }),
  ).get("/v1/config");
  assert.notEqual(wrong.status, 200);
});

test("unknown route returns a sanitized error", async () => {
  const response = await request(app).get("/does-not-exist");
  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { error: { code: "NOT_FOUND" } });
});

test("public config retains beta trust and pinned prover metadata without internal fields", async () => {
  const shielded = {
    launchMode: "experimental-single-operator" as const,
    proverRelease: {
      manifestPath: "/zk/mainnet/withdraw-v1-beta-fixture.json",
      manifestSha256: "a".repeat(64),
    },
    vaultAddress: "0x1111111111111111111111111111111111111111",
    stateRegistryAddress: "0x2222222222222222222222222222222222222222",
    treeVersion: 1,
    assets: [
      {
        address: "0x3333333333333333333333333333333333333333",
        symbol: "USDG",
        decimals: 6,
        denominationRaw: "1000000",
      },
    ],
  };
  const mainnet = createApp({
    environment: "mainnet",
    chainId: 4663,
    chainName: "Mainnet fixture",
    explorerUrl: "https://explorer.example",
    webOrigin: "https://web.example",
    operationsToken: "not-a-real-token",
    shielded,
  });
  const response = await request(mainnet).get("/v1/config");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.shielded, shielded);
  assert.equal(response.body.operationsToken, undefined);
  assert.equal(response.body.webOrigin, undefined);
});

test("external markets expose provenance and remain non-executable", async () => {
  const externalMarketService = {
    list: async () => [
      {
        id: "11111111-1111-4111-8111-111111111111",
        source: "pons_graduated",
        externalId: "0x1111111111111111111111111111111111111111",
        chainId: 4663,
        contractAddress: "0x1111111111111111111111111111111111111111",
        symbol: "PONS",
        name: "Pons",
        quoteSymbol: "WETH",
        status: "active",
        readOnly: true,
        metadata: {},
        validatedAt: "2026-10-18T00:00:00.000Z",
        bid: null,
        ask: null,
        currency: null,
        dailyVolume: null,
        quoteObservedAt: null,
        canTrade: false,
        provenance: "pons contracts on Robinhood Chain",
      },
    ],
  } as unknown as ExternalMarketService;
  const marketApp = createApp(
    {
      environment: "testnet",
      chainId: 46_630,
      chainName: "Test Chain",
      explorerUrl: "https://explorer.example",
      webOrigin: "http://127.0.0.1:3000",
    },
    { externalMarketService },
  );
  const response = await request(marketApp).get(
    "/v1/markets?source=pons_graduated&limit=25",
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.items[0].canTrade, false);
  assert.match(response.body.items[0].provenance, /pons contracts/u);
});

test("external market chart keeps swap and oracle provenance explicit", async () => {
  const externalMarketService = {
    list: async () => [],
    priceHistory: async (_marketId: string, input: { source: string }) => [
      {
        source: input.source,
        observedAt: "2026-10-18T00:00:00.000Z",
        price: "1.25",
        volume: "10",
        blockNumber: "91534593",
        transactionHash:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
      },
    ],
  } as unknown as ExternalMarketService;
  const marketApp = createApp(
    {
      environment: "testnet",
      chainId: 46_630,
      chainName: "Test Chain",
      explorerUrl: "https://explorer.example",
      webOrigin: "http://127.0.0.1:3000",
    },
    { externalMarketService },
  );
  const response = await request(marketApp).get(
    "/v1/markets/11111111-1111-4111-8111-111111111111/chart?source=swap&from=2026-10-17T00:00:00.000Z&to=2026-10-19T00:00:00.000Z",
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.source, "swap");
  assert.equal(response.body.items[0].source, "swap");
});

test("external market quote resolves only the server-validated route", async () => {
  let received: unknown;
  const externalMarketService = {
    list: async () => [],
    validatedRoute: async () => ({
      symbol: "AMD",
      chainId: 46_630,
      baseAddress: "0x1111111111111111111111111111111111111111",
      quoteAddress: "0x2222222222222222222222222222222222222222",
      poolAddress: "0x3333333333333333333333333333333333333333",
      venue: "zkblast_damm",
      baseDecimals: 18,
    }),
  } as unknown as ExternalMarketService;
  const swapService = {
    quote: async (input: unknown) => {
      received = input;
      return {
        chainId: 46_630,
        amountOut: "199000",
        minimumAmountOut: "198005",
        approval: { to: "0x1", data: "0x", value: "0" },
        swap: { to: "0x2", data: "0x", value: "0" },
      };
    },
  } as unknown as SwapService;
  const marketApp = createApp(
    {
      environment: "testnet",
      chainId: 46_630,
      chainName: "Test Chain",
      explorerUrl: "https://explorer.example",
      webOrigin: "http://127.0.0.1:3000",
    },
    { externalMarketService, swapService },
  );
  const response = await request(marketApp)
    .post("/v1/markets/11111111-1111-4111-8111-111111111111/quote")
    .send({
      quoteSymbol: "USDG",
      amount: "0.001",
      slippageBps: 50,
      recipient: "0x4444444444444444444444444444444444444444",
      deadline: "1800000000",
    });
  assert.equal(response.status, 200);
  assert.equal(response.body.amountIn, "1000000000000000");
  assert.deepEqual(received, {
    model: "damm",
    pool: "0x3333333333333333333333333333333333333333",
    tokenIn: "0x1111111111111111111111111111111111111111",
    amountIn: "1000000000000000",
    slippageBps: 50,
    recipient: "0x4444444444444444444444444444444444444444",
    deadline: "1800000000",
    token0ToToken1: true,
    maximumBinCrossings: 16,
  });
});
