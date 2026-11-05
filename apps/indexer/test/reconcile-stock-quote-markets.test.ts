import assert from "node:assert/strict";
import test from "node:test";

import { stockQuoteDiscoveryRecord } from "../src/stock-quote-catalog.js";
import { reconcileStockQuoteExternalMarkets } from "../src/reconcile-stock-quote-markets.js";

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
  { isTradingHalt: false, generatedAt: "2026-11-05T10:00:00.000Z" },
  "Approved issuer",
);

test("reconciles by issuer ID and contract address, never ticker alone", async () => {
  const sql = {
    async unsafe() {
      return [
        {
          external_id: record.issuerAssetId,
          contract_address: record.contractAddress,
          symbol: "MSFT",
          name: "Microsoft Stock Token",
          status: "active",
        },
      ];
    },
  };
  await reconcileStockQuoteExternalMarkets(sql, "zkblast_mainnet", [record]);
});

test("rejects address drift even when the ticker matches", async () => {
  const sql = {
    async unsafe() {
      return [
        {
          external_id: record.issuerAssetId,
          contract_address: `0x${"33".repeat(20)}`,
          symbol: "MSFT",
          name: "Microsoft Stock Token",
          status: "active",
        },
      ];
    },
  };
  await assert.rejects(
    () => reconcileStockQuoteExternalMarkets(sql, "zkblast_mainnet", [record]),
    /STOCK_QUOTE_EXTERNAL_MARKET_ADDRESS_MISMATCH/u,
  );
});

test("promotes only an exact-address legacy bootstrap identity", async () => {
  const calls: string[] = [];
  const sql = {
    async unsafe(query: string) {
      calls.push(query);
      if (calls.length === 1) return [];
      if (calls.length === 2)
        return [
          {
            external_id: `mainnet:${record.contractAddress.toLowerCase()}`,
            contract_address: record.contractAddress,
            symbol: record.symbol,
            name: record.instrumentName,
            status: "active",
          },
        ];
      return [];
    },
  };
  await reconcileStockQuoteExternalMarkets(sql, "zkblast_mainnet", [record]);
  assert.equal(calls.length, 3);
  assert.match(calls[2]!, /set external_id=\$3/u);
});

test("rejects duplicate issuer records before any promotion", async () => {
  const row = {
    external_id: record.issuerAssetId,
    contract_address: record.contractAddress,
    symbol: record.symbol,
    name: record.instrumentName,
    status: "active",
  };
  const sql = { async unsafe() { return [row, row]; } };
  await assert.rejects(
    () => reconcileStockQuoteExternalMarkets(sql, "zkblast_mainnet", [record]),
    /STOCK_QUOTE_EXTERNAL_MARKET_DUPLICATE/u,
  );
});
