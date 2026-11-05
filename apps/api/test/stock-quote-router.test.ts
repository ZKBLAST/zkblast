import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import request from "supertest";

import { createStockQuoteRouter } from "../src/stock-quote-router.js";
import type { StockQuoteService } from "../src/stock-quote-service.js";

const stock = `0x${"11".repeat(20)}`;
const service: StockQuoteService = {
  async assets(query) {
    return [{ contractAddress: stock, availability: query.availability ?? "listed" }];
  },
  async asset(address) {
    return address === stock ? { contractAddress: stock, quoteTradingEnabled: true } : null;
  },
  async destinationCapabilities(address) {
    return address === stock
      ? [
          { migrationMode: "damm", enabled: true },
          { migrationMode: "dlmm", enabled: false },
        ]
      : [];
  },
  async launchPolicyBindings(query) {
    return [{ launchId: query.launchId, quoteAssetAddress: query.quoteAssetAddress }];
  },
  async executionReceipts(query) {
    return [{ launchId: query.launchId, quoteAssetAddress: query.quoteAssetAddress }];
  },
};

test("serves a bounded fail-closed stock quote catalog", async () => {
  const app = express().use("/v1/stock-quotes", createStockQuoteRouter(service));
  const list = await request(app).get("/v1/stock-quotes/assets?availability=listed&limit=20");
  assert.equal(list.status, 200);
  assert.equal(list.body.items[0].contractAddress, stock);
  const detail = await request(app).get(`/v1/stock-quotes/assets/${stock}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.quoteTradingEnabled, true);
  const destinations = await request(app).get(
    `/v1/stock-quotes/assets/${stock}/destinations`,
  );
  assert.equal(destinations.status, 200);
  assert.deepEqual(destinations.body.items, [
    { migrationMode: "damm", enabled: true },
    { migrationMode: "dlmm", enabled: false },
  ]);
  const missing = await request(app).get(`/v1/stock-quotes/assets/0x${"22".repeat(20)}`);
  assert.equal(missing.status, 404);
});

test("rejects unsupported filters and unbounded pages", async () => {
  const app = express().use("/v1/stock-quotes", createStockQuoteRouter(service));
  assert.equal((await request(app).get("/v1/stock-quotes/assets?limit=201")).status, 500);
  assert.equal((await request(app).get("/v1/stock-quotes/assets?availability=unknown")).status, 500);
});

test("serves bounded launch policy bindings and execution receipts", async () => {
  const app = express().use("/v1/stock-quotes", createStockQuoteRouter(service));
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
  assert.equal((await request(app).get("/v1/stock-quotes/execution-receipts?limit=201")).status, 500);
});
