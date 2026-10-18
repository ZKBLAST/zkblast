import assert from "node:assert/strict";
import test from "node:test";

import {
  ponsGraduatedMarketSchema,
  stockAssetResponseSchema,
  stockQuoteResponseSchema,
} from "../src/index.js";

const deployment = {
  contractAddress: "0x1Cdad396DB64BDa184d5182A97Dd9B3C62100b7D",
  chainId: 4663,
};

test("accepts validated chain-4663 stock metadata and quotes", () => {
  const common = { tokenSymbol: "AAPL", deployments: [deployment] };
  assert.equal(
    stockAssetResponseSchema.parse({
      assets: [
        {
          ...common,
          id: `0x${"1".repeat(64)}`,
          tokenName: "Apple Stock Token",
          currentMultiplier: "1.000000000000000000",
          pendingMultiplier: "",
          logoUrl: "https://cdn.robinhood.com/aapl.png",
          status: "ASSET_STATUS_ACTIVE",
        },
      ],
    }).assets.length,
    1,
  );
  assert.equal(
    stockQuoteResponseSchema.parse({
      quotes: [
        {
          ...common,
          bid: "213.45",
          ask: "213.47",
          currency: "USD",
          dailyTradingVolume: "48293710",
          isTradingHalt: false,
          generatedAt: "2026-10-18T00:00:00.000Z",
        },
      ],
    }).quotes.length,
    1,
  );
});

test("rejects crossed stock quotes and pons tokens without graduation proof", () => {
  assert.throws(() =>
    stockQuoteResponseSchema.parse({
      quotes: [
        {
          tokenSymbol: "AAPL",
          deployments: [deployment],
          bid: "214",
          ask: "213",
          currency: "USD",
          dailyTradingVolume: "1",
          isTradingHalt: false,
          generatedAt: "2026-10-18T00:00:00.000Z",
        },
      ],
    }),
  );
  assert.throws(() =>
    ponsGraduatedMarketSchema.parse({
      chainId: 4663,
      factoryAddress: deployment.contractAddress,
      tokenAddress: deployment.contractAddress,
      poolIdentifier: deployment.contractAddress,
      quoteAddress: deployment.contractAddress,
      name: "Token",
      symbol: "TKN",
      decimals: 18,
      pairedPrincipalRaw: "1",
      graduationThresholdRaw: "2",
      graduated: false,
      observedBlock: 1,
    }),
  );
});
