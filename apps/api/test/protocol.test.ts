import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import { redact } from "@zkblast/observability";

import { createApp } from "../src/app.js";
import {
  ProtocolService,
  type ProtocolReadStore,
} from "../src/protocol-service.js";
import type { OperationsService } from "../src/operations-service.js";

const store: ProtocolReadStore = {
  pools: async () => [{ address: "0xpool", kind: "damm" }],
  swaps: async () => [{ transactionHash: "0xtx" }],
  activity: async () => [{ eventName: "LiquidityAdded" }],
  positions: async () => [{ positionId: "1" }],
  indexerStatus: async () => ({
    indexedBlock: 95n,
    finalizedBlock: 95n,
    updatedAt: new Date("2026-10-17T00:00:00Z"),
  }),
  recentFailedTransactions: async () => 0,
};
const service = new ProtocolService(store, async () => 100n);
const app = createApp(
  {
    environment: "testnet",
    chainId: 46630,
    chainName: "Testnet",
    explorerUrl: "https://explorer.example",
    webOrigin: "https://app.example",
  },
  { protocolService: service },
);

test("read API exposes protocol pages behind the common rate limiter", async () => {
  const response = await request(app).get("/v1/protocol/pools?limit=10");
  assert.equal(response.status, 200);
  assert.equal(response.body.items[0].kind, "damm");
  assert.ok(response.headers["ratelimit-policy"]);
});

test("read API exposes validated activity beyond swaps", async () => {
  const response = await request(app).get("/v1/protocol/activity?limit=10");
  assert.equal(response.status, 200);
  assert.equal(response.body.items[0].eventName, "LiquidityAdded");
});

test("readiness and metrics report RPC lag without secrets", async () => {
  const readiness = await request(app).get("/ready");
  const metrics = await request(app).get("/v1/protocol/metrics");
  assert.equal(readiness.status, 200);
  assert.equal(metrics.body.lag, "5");
  assert.equal(JSON.stringify(metrics.body).includes("SUPABASE"), false);
});

test("structured log redaction recursively removes server credentials", () => {
  const output = redact({
    requestId: "safe",
    context: {
      SUPABASE_SERVICE_ROLE_KEY: "secret",
      rpcUrl: "https://private.example",
    },
  });
  assert.deepEqual(output, {
    requestId: "safe",
    context: {
      SUPABASE_SERVICE_ROLE_KEY: "[REDACTED]",
      rpcUrl: "[REDACTED]",
    },
  });
});

test("operations detail requires the environment-scoped bearer token", async () => {
  const operationsToken = "test-operations-token-that-is-long-enough";
  const operationsService = {
    health: async () => ({
      status: "healthy",
      checkedAt: new Date(0).toISOString(),
    }),
  } as unknown as OperationsService;
  const protectedApp = createApp(
    {
      environment: "testnet",
      chainId: 46_630,
      chainName: "Testnet",
      explorerUrl: "https://explorer.example",
      webOrigin: "https://app.example",
      operationsToken,
    },
    { protocolService: service, operationsService },
  );

  const missing = await request(protectedApp).get(
    "/v1/protocol/operations/health",
  );
  const invalid = await request(protectedApp)
    .get("/v1/protocol/operations/health")
    .set("authorization", "Bearer wrong-token");
  const valid = await request(protectedApp)
    .get("/v1/protocol/operations/health")
    .set("authorization", `Bearer ${operationsToken}`);

  assert.equal(missing.status, 401);
  assert.equal(invalid.status, 401);
  assert.equal(valid.status, 200);
  assert.deepEqual(missing.body, {
    error: { code: "OPERATIONS_AUTH_REQUIRED" },
  });
  assert.equal(valid.body.status, "healthy");
});
