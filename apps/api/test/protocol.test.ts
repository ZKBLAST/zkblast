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
import type { LiquidityService } from "../src/liquidity-service.js";

const store: ProtocolReadStore = {
  priceHistory: async () => [{ price: "1.25", priceUnit: "USDG" }],
  poolCandles: async () => [{ open: "1", close: "2", priceUnit: "USDG" }],
  poolStats: async () => ({ priceKind: "pool", asOfBlock: "95" }),
  poolTrades: async () => [{
    side: "buy",
    trader: null,
    privacy: "shielded",
    blockNumber: "95",
    transactionHash: `0x${"ab".repeat(32)}`,
    logIndex: 7,
  }],
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

test("owner positions fall back to indexed data when live RPC enrichment fails", async () => {
  const owner = "0xb5c0ed0252d1906fca50664eb2198aea0679920b";
  const fallbackStore: ProtocolReadStore = {
    ...store,
    positions: async () => [{
      onchainPositionId: "7",
      poolAddress: "0x0000000000000000000000000000000000000001",
      model: "dlmm",
      token0Symbol: "ZKBLAST",
      token1Symbol: "MSFT",
    }],
  };
  const fallbackApp = createApp(
    {
      environment: "mainnet",
      chainId: 4663,
      chainName: "Robinhood Chain",
      explorerUrl: "https://explorer.example",
      webOrigin: "https://app.example",
    },
    {
      protocolService: new ProtocolService(fallbackStore, async () => 100n),
      liquidityService: {
        positionsForOwner: async () => {
          throw new Error("RPC_TIMEOUT");
        },
      } as unknown as LiquidityService,
    },
  );

  const response = await request(fallbackApp).get(
    `/v1/protocol/positions?limit=100&owner=${owner}`,
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.live, false);
  assert.equal(response.body.items[0].onchainPositionId, "7");
});

test("owner positions remain available when accounting enrichment fails", async () => {
  const owner = "0xb5c0ed0252d1906fca50664eb2198aea0679920b";
  const fallbackStore: ProtocolReadStore = {
    ...store,
    positions: async () => [{
      onchainPositionId: "8",
      poolAddress: "0x0000000000000000000000000000000000000002",
      model: "damm",
      token0Symbol: "ZKBLAST",
      token1Symbol: "USDG",
    }],
    positionAccounting: async () => {
      throw new Error("ACCOUNTING_SCHEMA_UNAVAILABLE");
    },
  };
  const fallbackApp = createApp(
    {
      environment: "mainnet",
      chainId: 4663,
      chainName: "Robinhood Chain",
      explorerUrl: "https://explorer.example",
      webOrigin: "https://app.example",
    },
    {
      protocolService: new ProtocolService(fallbackStore, async () => 100n),
      liquidityService: {
        positionsForOwner: async () => {
          throw new Error("RPC_TIMEOUT");
        },
      } as unknown as LiquidityService,
    },
  );

  const response = await request(fallbackApp).get(
    `/v1/protocol/positions?limit=100&owner=${owner}`,
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.live, false);
  assert.equal(response.body.items[0].onchainPositionId, "8");
});

test("pool chart compatibility and Pools v2 reads preserve explicit units", async () => {
  const pool = "0x0000000000000000000000000000000000000001";
  const range = "from=2026-10-16T00:00:00.000Z&to=2026-10-17T00:00:00.000Z";
  const [legacy, candles, stats, trades] = await Promise.all([
    request(app).get(`/v1/protocol/pools/${pool}/chart?${range}`),
    request(app).get(`/v1/protocol/pools/${pool}/candles?${range}&intervalSeconds=300`),
    request(app).get(`/v1/protocol/pools/${pool}/stats`),
    request(app).get(`/v1/protocol/pools/${pool}/trades?limit=10`),
  ]);
  assert.equal(legacy.status, 200);
  assert.equal(legacy.body.items[0].priceUnit, "USDG");
  assert.equal(candles.status, 200);
  assert.equal(candles.body.items[0].priceUnit, "USDG");
  assert.equal(stats.body.stats.priceKind, "pool");
  assert.equal(trades.body.items[0].trader, null);
  assert.equal(trades.body.items[0].privacy, "shielded");
  assert.equal(trades.body.nextCursor, null);
});

test("pool trade tape validates and emits an opaque pagination cursor", async () => {
  const pool = "0x0000000000000000000000000000000000000001";
  const page = await request(app).get(`/v1/protocol/pools/${pool}/trades?limit=1`);
  assert.equal(page.status, 200);
  assert.equal(
    page.body.nextCursor,
    `95:0x${"ab".repeat(32)}:7`,
  );

  const next = await request(app).get(
    `/v1/protocol/pools/${pool}/trades?limit=1&cursor=${encodeURIComponent(page.body.nextCursor)}`,
  );
  const malformed = await request(app).get(
    `/v1/protocol/pools/${pool}/trades?cursor=not-a-cursor`,
  );
  assert.equal(next.status, 200);
  assert.equal(malformed.status, 400);
});

test("pool candles reject unsupported intervals and excessive ranges", async () => {
  const pool = "0x0000000000000000000000000000000000000001";
  const invalidInterval = await request(app).get(
    `/v1/protocol/pools/${pool}/candles?from=2026-10-16T00:00:00Z&to=2026-10-17T00:00:00Z&intervalSeconds=120`,
  );
  const excessive = await request(app).get(
    `/v1/protocol/pools/${pool}/candles?from=2026-01-01T00:00:00Z&to=2026-10-17T00:00:00Z&intervalSeconds=300`,
  );
  assert.equal(invalidInterval.status, 400);
  assert.equal(excessive.status, 400);
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
