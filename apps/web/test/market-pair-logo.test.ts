import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isNearlySquare,
  marketDisplayQuoteSymbol,
} from "../src/components/markets/MarketPairLogo.js";

test("square logo detection keeps non-square artwork contained", () => {
  assert.equal(isNearlySquare(512, 512), true);
  assert.equal(isNearlySquare(1000, 920), true);
  assert.equal(isNearlySquare(1200, 630), false);
  assert.equal(isNearlySquare(0, 0), false);
});

test("execution pair label takes precedence over the USD reference quote", () => {
  const market = {
    quoteSymbol: "USD",
    pairCandidates: [
      { quoteSymbol: "WETH", logoUrl: null, routeStatus: "planned" },
      { quoteSymbol: "USDG", logoUrl: null, routeStatus: "validated" },
    ],
  } as const;

  assert.equal(marketDisplayQuoteSymbol(market), "USDG");
});
