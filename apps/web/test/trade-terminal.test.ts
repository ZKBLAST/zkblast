import assert from "node:assert/strict";
import { test } from "node:test";
import {
  tradeInstruments,
  tradeMode,
  tradePanel,
} from "../src/lib/trade-instruments.js";
import { legacyTradeUrl } from "../src/lib/legacy-trade-url.js";
import { completedImageState } from "../src/components/markets/AssetLogo.js";
import { nav } from "../src/lib/nav.js";
import type { ExternalMarket, ProtocolPool } from "../src/types/application.js";

const pool: ProtocolPool = {
  chainId: 4663,
  address: "0x0000000000000000000000000000000000000011",
  model: "dlmm",
  feeBps: 30,
  status: "active",
  createdBlock: "1",
  token0Address: "0x0000000000000000000000000000000000000001",
  token0Symbol: "BASE",
  token0Decimals: 18,
  token1Address: "0x0000000000000000000000000000000000000002",
  token1Symbol: "QUOTE",
  token1Decimals: 6,
};
const market = {
  id: "market",
  contractAddress: pool.token0Address,
  symbol: "BASE",
  quoteSymbol: "USD",
  pairCandidates: [
    { quoteSymbol: "QUOTE", routeStatus: "observed", logoUrl: null },
  ],
} as unknown as ExternalMarket;

test("primary navigation offers one Trade entry, not four workflows", () => {
  assert.deepEqual(
    nav.map((item) => item.label),
    ["Trade", "Analytics", "Docs"],
  );
});
test("legacy URLs preserve pool selection and open the intended mode", () => {
  const target = new URL(
    legacyTradeUrl(
      { pool: pool.address, next: "https://example.com" },
      { mode: "liquidity" },
    ),
    "https://zkblast.test",
  );
  assert.equal(target.pathname, "/trade");
  assert.equal(target.searchParams.get("pool"), pool.address);
  assert.equal(target.searchParams.get("mode"), "liquidity");
  assert.equal(target.searchParams.has("next"), false);
  assert.equal(
    legacyTradeUrl({}, { panel: "positions" }),
    "/trade?panel=positions",
  );
  assert.equal(
    legacyTradeUrl({}, { mode: "shielded" }),
    "/trade?mode=shielded",
  );
});
test("invalid modes cannot create unknown terminal panels", () => {
  assert.equal(tradeMode("withdraw-any-token"), "swap");
  assert.equal(tradePanel("all-users"), "positions");
  assert.equal(tradeMode("shielded"), "shielded");
});
test("active protocol pool and matching catalogue entry become one shared selection", () => {
  const items = tradeInstruments([pool], [market]);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.market?.id, market.id);
  assert.equal(items[0]?.pool?.address, pool.address);
  assert.equal(items[0]?.quote, pool.token1Symbol);
});
test("catalogue-only markets cannot acquire an executable pool from a symbol match", () => {
  const items = tradeInstruments(
    [pool],
    [
      {
        ...market,
        contractAddress: "0x0000000000000000000000000000000000000003",
      },
    ],
  );
  assert.equal(items.length, 2);
  assert.equal(items[1]?.pool, null);
});
test("paused pools are not offered as active execution instruments", () => {
  const items = tradeInstruments([{ ...pool, status: "paused" }], [market]);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.pool, null);
});
test("cached logos resolve immediately; broken images stop loading", () => {
  assert.equal(
    completedImageState({ complete: true, naturalWidth: 100 }),
    "ready",
  );
  assert.equal(
    completedImageState({ complete: true, naturalWidth: 0 }),
    "failed",
  );
  assert.equal(
    completedImageState({ complete: false, naturalWidth: 0 }),
    "loading",
  );
});

test("a validated same-chain route remains executable without a duplicate protocol pool row", () => {
  const routeMarket = {
    ...market,
    contractAddress: "0x0000000000000000000000000000000000000003",
    metadata: { executionDecimals: 18 },
    pairCandidates: [
      {
        quoteSymbol: "USDG",
        quoteAddress: pool.token1Address,
        baseAddress: "0x0000000000000000000000000000000000000003",
        executionChainId: 4663,
        routeStatus: "validated",
        venue: "zkblast_damm",
        poolIdentifier: "0x0000000000000000000000000000000000000012",
      },
    ],
  } as unknown as ExternalMarket;
  const assetsPool = { ...pool, token1Symbol: "USDG" };
  const items = tradeInstruments([assetsPool], [routeMarket], 4663);
  assert.equal(items[1]?.pool?.model, "damm");
  assert.equal(items[1]?.pool?.feeBps, null);
  assert.equal(items[1]?.pool?.token0Symbol, "USDG");
  assert.equal(items[1]?.pool?.token1Symbol, "BASE");
  const crossNetwork = tradeInstruments([assetsPool], [routeMarket], 46630);
  assert.equal(crossNetwork[1]?.pool, null);
});
