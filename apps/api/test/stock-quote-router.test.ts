import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import request from "supertest";

import { createStockQuoteRouter } from "../src/stock-quote-router.js";
import type { StockQuoteService } from "../src/stock-quote-service.js";

const stock = `0x${"11".repeat(20)}`;
const service: StockQuoteService = {
  async assets(query) {
    return [
      { contractAddress: stock, availability: query.availability ?? "listed" },
    ];
  },
  async asset(address) {
    return address === stock
      ? {
          contractAddress: stock,
          symbol: "MSFT",
          tokenDecimals: 18,
          currentMultiplier: "1.000412952576205964",
          availability: "eligible",
          marketState: "active",
          quoteTradingEnabled: false,
          graduationEnabled: false,
          priceFeedAddress: null,
          maxOracleAgeSeconds: null,
        }
      : null;
  },
  async destinationCapabilities(address) {
    return address === stock
      ? [
          { migrationMode: "damm", enabled: true },
          { migrationMode: "dlmm", enabled: false },
        ]
      : [];
  },
  async launches(address) {
    return address === stock ? [{ launchId: `0x${"77".repeat(32)}` }] : [];
  },
  async graduations(address) {
    return address === stock ? [{ migrationId: `0x${"88".repeat(32)}` }] : [];
  },
  async launchPolicyBindings(query) {
    return [
      { launchId: query.launchId, quoteAssetAddress: query.quoteAssetAddress },
    ];
  },
  async executionReceipts(query) {
    return [
      {
        launchId: query.launchId,
        quoteAssetAddress: query.quoteAssetAddress,
        transactionHash: `0x${"55".repeat(32)}`,
        quoteAmountRaw: "1250000",
        internalSecret: "must-not-export",
      },
    ];
  },
};

test("serves a bounded fail-closed stock quote catalog", async () => {
  const app = express().use(
    "/v1/stock-quotes",
    createStockQuoteRouter(service),
  );
  const list = await request(app).get(
    "/v1/stock-quotes/assets?availability=listed&limit=20",
  );
  assert.equal(list.status, 200);
  assert.equal(list.body.items[0].contractAddress, stock);
  const detail = await request(app).get(`/v1/stock-quotes/assets/${stock}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.quoteTradingEnabled, false);
  const destinations = await request(app).get(
    `/v1/stock-quotes/assets/${stock}/destinations`,
  );
  assert.equal(destinations.status, 200);
  assert.deepEqual(destinations.body.items, [
    { migrationMode: "damm", enabled: true },
    { migrationMode: "dlmm", enabled: false },
  ]);
  const launches = await request(app).get(
    `/v1/stock-quotes/assets/${stock}/launches`,
  );
  assert.equal(launches.status, 200);
  assert.match(launches.body.items[0].launchId, /^0x[\da-f]{64}$/u);
  const graduations = await request(app).get(
    `/v1/stock-quotes/assets/${stock}/graduations`,
  );
  assert.equal(graduations.status, 200);
  assert.match(graduations.body.items[0].migrationId, /^0x[\da-f]{64}$/u);
  const missing = await request(app).get(
    `/v1/stock-quotes/assets/0x${"22".repeat(20)}`,
  );
  assert.equal(missing.status, 404);
});

test("previews stock quantity and policy state without inventing an oracle notional", async () => {
  const app = express()
    .use(express.json())
    .use("/v1/stock-quotes", createStockQuoteRouter(service));
  const preview = await request(app).post("/v1/stock-quotes/preview").send({
    contractAddress: stock,
    amountRaw: "1250000000000000000",
    operation: "create_launch",
    migrationMode: "damm",
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.amount, "1.25");
  assert.equal(preview.body.multiplier, "1.000412952576205964");
  assert.equal(preview.body.operationAllowed, false);
  assert.equal(preview.body.destinationEnabled, true);
  assert.equal(preview.body.usdNotionalX18, null);
  assert.equal(preview.body.executable, false);
  assert.deepEqual(preview.body.reasons, [
    "ASSET_NOT_LISTED",
    "QUOTE_TRADING_DISABLED",
    "ORACLE_NOT_CONFIGURED",
  ]);
});

test("returns a validated onchain USD notional only after every policy gate passes", async () => {
  const validatedService: StockQuoteService = {
    ...service,
    async asset(address) {
      if (address !== stock) return null;
      return {
        contractAddress: stock,
        symbol: "MSFT",
        tokenDecimals: 18,
        currentMultiplier: "1.000000000000000000",
        availability: "listed",
        marketState: "active",
        quoteTradingEnabled: true,
        graduationEnabled: true,
        priceFeedAddress: `0x${"44".repeat(20)}`,
        maxOracleAgeSeconds: 3_600,
      };
    },
    async validatedUsdNotional() {
      return {
        priceX18: "420000000000000000000",
        notionalX18: "525000000000000000000",
        updatedAt: "1793836800",
        roundId: "42",
        marketState: "active",
        multiplierX18: "1000000000000000000",
      };
    },
  };
  const app = express()
    .use(express.json())
    .use("/v1/stock-quotes", createStockQuoteRouter(validatedService));
  const preview = await request(app).post("/v1/stock-quotes/preview").send({
    contractAddress: stock,
    amountRaw: "1250000000000000000",
    operation: "create_launch",
    migrationMode: "damm",
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.oraclePriceX18, "420000000000000000000");
  assert.equal(preview.body.usdNotionalX18, "525000000000000000000");
  assert.equal(preview.body.oracleRoundId, "42");
  assert.equal(preview.body.executable, true);
  assert.deepEqual(preview.body.reasons, []);
});

test("rejects unsupported filters and unbounded pages", async () => {
  const app = express().use(
    "/v1/stock-quotes",
    createStockQuoteRouter(service),
  );
  assert.equal(
    (await request(app).get("/v1/stock-quotes/assets?limit=201")).status,
    500,
  );
  assert.equal(
    (await request(app).get("/v1/stock-quotes/assets?availability=unknown"))
      .status,
    500,
  );
});

test("serves bounded launch policy bindings and execution receipts", async () => {
  const app = express().use(
    "/v1/stock-quotes",
    createStockQuoteRouter(service),
  );
  const launchId = `0x${"33".repeat(32)}`;
  const bindings = await request(app).get(
    `/v1/stock-quotes/policy-bindings?launchId=${launchId}&quoteAssetAddress=${stock}`,
  );
  assert.equal(bindings.status, 200);
  assert.equal(bindings.body.items[0].launchId, launchId);
  assert.equal(bindings.body.items[0].quoteAssetAddress, stock);
  const receipts = await request(app).get(
    `/v1/stock-quotes/execution-receipts?launchId=${launchId}&limit=25`,
  );
  assert.equal(receipts.status, 200);
  assert.equal(receipts.body.items[0].launchId, launchId);
  assert.equal(
    (await request(app).get("/v1/stock-quotes/execution-receipts?limit=201"))
      .status,
    500,
  );
});

test("exports allowlisted public receipts as JSON or CSV", async () => {
  const app = express().use(
    "/v1/stock-quotes",
    createStockQuoteRouter(service),
  );
  const json = await request(app).get(
    `/v1/stock-quotes/execution-receipts/export?format=json&quoteAssetAddress=${stock}`,
  );
  assert.equal(json.status, 200);
  assert.equal(json.body.items[0].quoteAmountRaw, "1250000");
  assert.equal(json.body.items[0].internalSecret, undefined);

  const csv = await request(app).get(
    `/v1/stock-quotes/execution-receipts/export?format=csv&quoteAssetAddress=${stock}`,
  );
  assert.equal(csv.status, 200);
  assert.match(csv.headers["content-type"] ?? "", /^text\/csv/u);
  assert.match(csv.text, /quoteAmountRaw/u);
  assert.doesNotMatch(csv.text, /must-not-export/u);
});
