import assert from "node:assert/strict";
import test from "node:test";

import type { Address, Hex } from "viem";

import {
  StockQuoteClient,
  normalizeStockQuoteAsset,
  stockQuoteAmountBreakdown,
  stockQuoteOperationAllowed,
  stockQuoteUsdNotionalX18,
  type StockQuoteAsset,
} from "../src/index.js";

const asset: StockQuoteAsset = {
  chainId: 4663,
  issuerAssetId: `0x${"11".repeat(32)}` as Hex,
  contractAddress: `0x${"22".repeat(20)}` as Address,
  symbol: "AAPL",
  instrumentName: "Apple Stock Token",
  issuerName: "Approved issuer",
  tokenDecimals: 18,
  currentMultiplierX18: 10n ** 18n,
  availability: "listed",
  marketState: "active",
  quoteTradingEnabled: true,
  graduationEnabled: false,
  priceFeedAddress: `0x${"33".repeat(20)}` as Address,
  maxOracleAgeSeconds: 3600,
};

test("normalizes address-bound stock quote metadata", () => {
  const normalized = normalizeStockQuoteAsset(asset);
  assert.equal(normalized.symbol, "AAPL");
  const { priceFeedAddress: _priceFeedAddress, ...withoutFeed } = asset;
  void _priceFeedAddress;
  assert.throws(() =>
    normalizeStockQuoteAsset({
      ...withoutFeed,
      availability: "discovered",
    }),
  );
});

test("uses the same fail-closed session operation matrix as the guard", () => {
  assert.equal(stockQuoteOperationAllowed(asset, "buy"), true);
  assert.equal(
    stockQuoteOperationAllowed({ ...asset, marketState: "closed" }, "buy"),
    false,
  );
  assert.equal(
    stockQuoteOperationAllowed({ ...asset, marketState: "halted" }, "sell"),
    true,
  );
  assert.equal(
    stockQuoteOperationAllowed({ ...asset, marketState: "emergency" }, "exit"),
    true,
  );
});

test("calculates multiplier-adjusted stock quote notional", () => {
  assert.equal(
    stockQuoteUsdNotionalX18({
      rawAmount: 2n * 10n ** 18n,
      tokenDecimals: 18,
      priceX18: 250n * 10n ** 18n,
      multiplierX18: 2n * 10n ** 18n,
    }),
    1_000n * 10n ** 18n,
  );
  assert.equal(
    stockQuoteUsdNotionalX18({
      rawAmount: 1n,
      tokenDecimals: 8,
      priceX18: 250n * 10n ** 18n,
      multiplierX18: 10n ** 18n,
    }),
    2_500_000_000_000n,
  );
  assert.equal(
    stockQuoteUsdNotionalX18({
      rawAmount: 10n ** 20n,
      tokenDecimals: 20,
      priceX18: 250n * 10n ** 18n,
      multiplierX18: 10n ** 18n,
    }),
    250n * 10n ** 18n,
  );
});

test("keeps raw, native and multiplier-adjusted stock quantities distinct", () => {
  assert.deepEqual(
    stockQuoteAmountBreakdown({
      rawAmount: 125_000_000n,
      tokenDecimals: 8,
      multiplierX18: 2n * 10n ** 18n,
    }),
    {
      rawAmount: 125_000_000n,
      tokenDecimals: 8,
      nativeAmountX18: 1_250_000_000_000_000_000n,
      multiplierX18: 2n * 10n ** 18n,
      adjustedAmountX18: 2_500_000_000_000_000_000n,
    },
  );
  assert.throws(() =>
    stockQuoteAmountBreakdown({
      rawAmount: 1n,
      tokenDecimals: 37,
      multiplierX18: 10n ** 18n,
    }),
  );
});

test("builds address-bound onchain stock quote reads", () => {
  const client = new StockQuoteClient({
    chainId: 4663,
    assetRegistry: `0x${"44".repeat(20)}` as Address,
    oracleGuard: `0x${"55".repeat(20)}` as Address,
  });
  assert.equal(
    client.assetConfig(asset.contractAddress).functionName,
    "quoteAssetConfig",
  );
  assert.equal(
    client.sessionPolicy(asset.contractAddress).functionName,
    "sessionPolicy",
  );
  assert.deepEqual(
    client.validatedNotional(asset.contractAddress, "buy", 12n).args,
    [asset.contractAddress, 2, 12n],
  );
  assert.throws(() =>
    client.validatedNotional(asset.contractAddress, "buy", -1n),
  );
});

test("keeps DAMM and DLMM destination reads independently address-bound", () => {
  const destinationRegistry = "0x0000000000000000000000000000000000000003";
  const client = new StockQuoteClient({
    chainId: 4663,
    assetRegistry: "0x0000000000000000000000000000000000000001",
    oracleGuard: "0x0000000000000000000000000000000000000002",
    destinationRegistry,
  });
  assert.deepEqual(
    client.destinationEnabled(asset.contractAddress, "damm").args,
    [asset.contractAddress, 0],
  );
  assert.deepEqual(
    client.destinationEnabled(asset.contractAddress, "dlmm").args,
    [asset.contractAddress, 1],
  );
});
