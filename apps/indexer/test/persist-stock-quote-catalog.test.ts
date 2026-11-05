import assert from "node:assert/strict";
import test from "node:test";

import { persistStockQuoteCatalog } from "../src/persist-stock-quote-catalog.js";
import { stockQuoteDiscoveryRecord } from "../src/stock-quote-catalog.js";

test("persists discovery data without authorizing trading", async () => {
  const calls: { query: string; parameters: readonly unknown[] }[] = [];
  const sql = {
    async unsafe(query: string, parameters: readonly unknown[] = []) {
      calls.push({ query, parameters });
      return [];
    },
  };
  const observedAt = "2026-11-05T10:00:00.000Z";
  const record = stockQuoteDiscoveryRecord(
    {
      id: `0x${"11".repeat(32)}`,
      tokenSymbol: "MSFT",
      tokenName: "Microsoft Stock Token",
      tokenDecimals: 18,
      currentMultiplier: "1",
      pendingMultiplier: "",
      status: "ASSET_STATUS_ACTIVE",
      deployment: { chainId: 4663, contractAddress: `0x${"22".repeat(20)}` },
    },
    { isTradingHalt: false, generatedAt: observedAt },
    "Approved issuer",
  );
  await persistStockQuoteCatalog(
    sql,
    "zkblast_mainnet",
    { chainId: 4663, sourceHash: record.sourceHash, issuerName: record.issuerName, sourceObservedAt: observedAt },
    [record],
  );
  assert.equal(calls.length, 2);
  assert.match(calls[1]!.query, /values\(\$1,[\s\S]*false,false,null,null/u);
  assert.match(calls[1]!.query, /market_state in \('halted','degraded','emergency'\) then false/u);
  assert.equal(calls[1]!.parameters[9], "verified");
});

test("rejects schema injection and cross-chain records", async () => {
  const sql = { async unsafe() { return []; } };
  await assert.rejects(() =>
    persistStockQuoteCatalog(
      sql,
      "zkblast_mainnet;drop schema public",
      { chainId: 4663, sourceHash: `0x${"11".repeat(32)}`, issuerName: "Issuer", sourceObservedAt: "2026-11-05T10:00:00.000Z" },
      [],
    ),
  );
});
