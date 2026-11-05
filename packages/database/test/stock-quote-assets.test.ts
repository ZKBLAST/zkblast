import assert from "node:assert/strict";
import test from "node:test";

import {
  stockQuoteCatalogRecordSchema,
  stockQuoteDestinationCapabilitySchema,
} from "../src/stock-quote-assets.js";

const record = {
  chainId: 4663 as const,
  issuerAssetId: `0x${"11".repeat(32)}`,
  contractAddress: `0x${"22".repeat(20)}`,
  symbol: "AAPL",
  instrumentName: "Apple Stock Token",
  issuerName: "Approved issuer",
  tokenDecimals: 18,
  currentMultiplier: "1",
  pendingMultiplier: "",
  availability: "listed" as const,
  marketState: "active" as const,
  quoteTradingEnabled: true,
  graduationEnabled: false,
  priceFeedAddress: `0x${"33".repeat(20)}`,
  maxOracleAgeSeconds: 3600,
  observedAt: "2026-11-05T10:00:00.000Z",
  sourceHash: `0x${"44".repeat(32)}`,
};

test("accepts an address-bound listed stock quote", () => {
  const parsed = stockQuoteCatalogRecordSchema.parse(record);
  assert.equal(parsed.contractAddress, record.contractAddress);
});

test("rejects enabled ticker-only and unsafe market records", () => {
  assert.throws(() =>
    stockQuoteCatalogRecordSchema.parse({
      ...record,
      availability: "discovered",
      priceFeedAddress: null,
    }),
  );
  assert.throws(() =>
    stockQuoteCatalogRecordSchema.parse({
      ...record,
      marketState: "halted",
    }),
  );
});

test("requires independent funded evidence before enabling a DAMM or DLMM destination", () => {
  const capability = {
    chainId: 4663 as const,
    capabilityId: `0x${"54".repeat(32)}`,
    quoteAssetAddress: record.contractAddress,
    migrationMode: "dlmm" as const,
    adapterAddress: `0x${"55".repeat(20)}`,
    factoryAddress: `0x${"66".repeat(20)}`,
    adapterVersion: 1,
    adapterConfigurationHash: `0x${"77".repeat(32)}`,
    reviewReferenceHash: `0x${"88".repeat(32)}`,
    fundedAcceptanceHash: null,
    registeredAt: record.observedAt,
    acceptedAt: null,
    enabled: false,
  };
  assert.equal(stockQuoteDestinationCapabilitySchema.parse(capability).enabled, false);
  assert.throws(() =>
    stockQuoteDestinationCapabilitySchema.parse({ ...capability, enabled: true }),
  );
});
