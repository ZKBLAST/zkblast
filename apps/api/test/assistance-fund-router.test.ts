import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import request from "supertest";
import { createAssistanceFundRouter } from "../src/assistance-fund-router.js";
import type { AssistanceFundService } from "../src/assistance-fund-service.js";

test("returns bounded public Assistance Fund receipts", async () => {
  let receivedLimit = 0;
  const service: AssistanceFundService = {
    async summary(asset) {
      return { asset: asset ?? null, pendingBuybackRaw: "9900" };
    },
    async revenue(query) {
      receivedLimit = query.limit;
      return [{ transactionHash: `0x${"11".repeat(32)}` }];
    },
    async buybacks() {
      return [];
    },
    async burns() {
      return [];
    },
  };
  const app = express().use(
    "/v1/assistance-fund",
    createAssistanceFundRouter(service),
  );
  const summary = await request(app).get(
    `/v1/assistance-fund/summary?asset=0x${"22".repeat(20)}`,
  );
  assert.equal(summary.status, 200);
  assert.equal(summary.body.pendingBuybackRaw, "9900");
  const revenue = await request(app).get(
    "/v1/assistance-fund/revenue?limit=100",
  );
  assert.equal(revenue.status, 200);
  assert.equal(receivedLimit, 100);
  assert.equal(revenue.body.items.length, 1);
});

test("rejects unbounded pagination", async () => {
  const service = {
    async summary() {
      return {};
    },
    async revenue() {
      return [];
    },
    async buybacks() {
      return [];
    },
    async burns() {
      return [];
    },
  } satisfies AssistanceFundService;
  const app = express().use(
    "/v1/assistance-fund",
    createAssistanceFundRouter(service),
  );
  const response = await request(app).get(
    "/v1/assistance-fund/revenue?limit=101",
  );
  assert.equal(response.status, 500);
});
