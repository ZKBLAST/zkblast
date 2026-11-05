import assert from "node:assert/strict";
import test from "node:test";

import {
  stockQuoteDiscoveryRecord,
  assertStockQuoteSnapshotFresh,
  verifyStockQuoteAssetOnchain,
} from "../src/stock-quote-catalog.js";

const asset = {
  id: `0x${"11".repeat(32)}` as const,
  tokenSymbol: "AAPL",
  tokenName: "Apple Stock Token",
  tokenDecimals: 18,
  currentMultiplier: "1",
  pendingMultiplier: "",
  status: "ASSET_STATUS_ACTIVE" as const,
  deployment: {
    chainId: 4663 as const,
    contractAddress: `0x${"22".repeat(20)}` as const,
  },
};

test("maps existing issuer catalog data without enabling custody", () => {
  const record = stockQuoteDiscoveryRecord(
    asset,
    { isTradingHalt: false, generatedAt: "2026-11-05T10:00:00.000Z" },
    "Approved issuer",
  );
  assert.equal(record.availability, "verified");
  assert.equal(record.quoteTradingEnabled, false);
  assert.equal(record.graduationEnabled, false);
  assert.equal(record.contractAddress, asset.deployment.contractAddress);
});

test("maps issuer halts independently from catalog availability", () => {
  const record = stockQuoteDiscoveryRecord(
    asset,
    { isTradingHalt: true, generatedAt: "2026-11-05T10:00:00.000Z" },
    "Approved issuer",
  );
  assert.equal(record.availability, "verified");
  assert.equal(record.marketState, "halted");
});

test("preserves issuer token decimals instead of assuming eighteen", () => {
  const record = stockQuoteDiscoveryRecord(
    { ...asset, tokenDecimals: 6 },
    { isTradingHalt: false, generatedAt: "2026-11-05T10:00:00.000Z" },
    "Approved issuer",
  );
  assert.equal(record.tokenDecimals, 6);
});

test("rejects stale, future and malformed catalog snapshots", () => {
  const now = Date.parse("2026-11-05T12:00:00.000Z");
  assert.doesNotThrow(() =>
    assertStockQuoteSnapshotFresh("2026-11-05T11:59:00.000Z", now, 120),
  );
  assert.throws(() =>
    assertStockQuoteSnapshotFresh("2026-11-05T11:00:00.000Z", now, 120),
  );
  assert.throws(() =>
    assertStockQuoteSnapshotFresh("2026-11-05T12:01:00.000Z", now, 120),
  );
  assert.throws(() => assertStockQuoteSnapshotFresh("invalid", now, 120));
});

test("promotes only code-backed issuer addresses with matching decimals", async () => {
  const record = stockQuoteDiscoveryRecord(
    asset,
    { isTradingHalt: false, generatedAt: "2026-11-05T10:00:00.000Z" },
    "Approved issuer",
  );
  const verified = await verifyStockQuoteAssetOnchain(
    {
      async chainId() { return 4663; },
      async bytecode() { return "0x6000"; },
      async decimals() { return 18; },
    },
    record,
  );
  assert.equal(verified.availability, "eligible");
  await assert.rejects(() =>
    verifyStockQuoteAssetOnchain(
      {
        async chainId() { return 4663; },
        async bytecode() { return undefined; },
        async decimals() { return 18; },
      },
      record,
    ),
  );
});
