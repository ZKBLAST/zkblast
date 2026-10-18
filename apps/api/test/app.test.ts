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
  });
});

test("unknown route returns a sanitized error", async () => {
  const response = await request(app).get("/does-not-exist");
  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { error: { code: "NOT_FOUND" } });
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
