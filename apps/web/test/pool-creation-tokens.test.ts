import assert from "node:assert/strict";
import test from "node:test";
import { poolCreationTokens } from "../src/lib/pool-creation-tokens";
import type { ExternalMarket, ProtocolPool } from "../src/types/application";

const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const routeMetadata = { priority: 1, venue: null, poolIdentifier: null, liquidityRaw: null };
const pool = {
  chainId: 46630,
  token0Address: address(1),
  token0Symbol: "STOCK",
  token1Address: address(2),
  token1Symbol: "USDG",
} as ProtocolPool;
function market(overrides: Partial<ExternalMarket> = {}) {
  return {
    id: "stock",
    chainId: 4663,
    contractAddress: address(3),
    symbol: "STOCK",
    name: "Stock market",
    logoUrl: "https://example.com/logo.svg",
    pairCandidates: [],
    ...overrides,
  } as ExternalMarket;
}

test("same-network market and pool tokens deduplicate by address, not symbol", () => {
  const options = poolCreationTokens(
    [pool],
    [
      market({ chainId: 46630, contractAddress: address(1) }),
      market({ id: "other", chainId: 46630, contractAddress: address(4) }),
    ],
    46630,
  );
  assert.equal(options.filter((item) => item.address === address(1)).length, 1);
  assert.equal(options.filter((item) => item.symbol === "STOCK").length, 2);
  assert.equal(
    options.find((item) => item.address === address(1))?.name,
    "Stock market",
  );
});

test("foreign reference markets remain unavailable without a current-network contract", () => {
  const options = poolCreationTokens([], [market()], 46630);
  assert.equal(options[0]?.address, null);
  assert.ok(!options.some((item) => item.address === address(3)));
  assert.deepEqual(poolCreationTokens([pool], [], 4663), []);
  assert.deepEqual(poolCreationTokens([pool], [market()]), []);
});

test("network-specific route supplies actual base/quote tokens without native ETH substitution", () => {
  const routes: ExternalMarket["pairCandidates"] = [
    {
      ...routeMetadata,
      executionChainId: 46630,
      routeStatus: "validated",
      baseAddress: address(1),
      quoteAddress: address(2),
      quoteSymbol: "USDG",
      logoUrl: null,
    },
    {
      ...routeMetadata,
      executionChainId: 46630,
      routeStatus: "observed",
      baseAddress: address(1),
      quoteAddress: address(5),
      quoteSymbol: "ETH",
      logoUrl: null,
    },
    {
      ...routeMetadata,
      executionChainId: 4663,
      routeStatus: "validated",
      baseAddress: address(3),
      quoteAddress: address(6),
      quoteSymbol: "WETH",
      logoUrl: null,
    },
  ];
  const options = poolCreationTokens(
    [],
    [market({ pairCandidates: routes })],
    46630,
  );
  assert.deepEqual(options.map((item) => item.address).sort(), [
    address(1),
    address(2),
  ]);
});

test("disabled routes and zero-address sentinels cannot become token selections", () => {
  const routes: ExternalMarket["pairCandidates"] = [
    {
      ...routeMetadata,
      executionChainId: 46630,
      routeStatus: "disabled",
      baseAddress: address(1),
      quoteAddress: address(2),
      quoteSymbol: "USDG",
      logoUrl: null,
    },
  ];
  const options = poolCreationTokens(
    [],
    [
      market({ pairCandidates: routes }),
      market({ id: "zero", chainId: 46630, contractAddress: address(0) }),
    ],
    46630,
  );
  assert.ok(options.every((item) => item.address === null));
});
