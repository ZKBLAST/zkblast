import assert from "node:assert/strict";
import test from "node:test";
import { poolSpotPriceX18, projectPoolSwap, type SwapPool } from "../src/pool-swap-projection.js";
import {
  quoteMidpoint,
  poolStatePrice,
} from "../src/sync-reference-chart-prices.js";
import type { IndexedEvent } from "../src/domain.js";

const pool: SwapPool = {
  id: "pool",
  address: "0x0000000000000000000000000000000000000003",
  pool_kind: "damm",
  token_x_id: "x",
  token_y_id: "y",
  token_x_address: "0x0000000000000000000000000000000000000002",
  token_y_address: "0x0000000000000000000000000000000000000001",
  token_x_decimals: 18,
  token_y_decimals: 18,
  quote_token_id: "y",
  bin_step_bps: null,
};
const event = {
  contractAddress: pool.address,
  kind: "swap",
  eventName: "Swap",
  payload: {
    amountIn: "100",
    amountOut: "50",
    protocolFee: "0",
    tokenIn: pool.token_x_address,
    sender: "0x0000000000000000000000000000000000000004",
    recipient: "0x0000000000000000000000000000000000000005",
    blockTimestamp: "1700000000",
  },
} as unknown as IndexedEvent;
test("DAMM projection validates direction and positive amounts", () => {
  const projected = projectPoolSwap(event, pool, {
    reserve0: 1_000n,
    reserve1: 1_000n,
    activeBin: null,
  });
  assert.equal(projected?.tokenInId, "x");
  assert.equal(projected?.side, "sell");
  assert.equal(projected?.volumeQuoteRaw, "50");
  assert.equal(projected?.trader, event.payload.sender);
  assert.equal(
    projectPoolSwap(
      { ...event, payload: { ...event.payload, tokenIn: pool.address } },
      pool,
      { reserve0: 1_000n, reserve1: 1_000n, activeBin: null },
    ),
    null,
  );
  assert.equal(
    projectPoolSwap(
      { ...event, payload: { ...event.payload, amountOut: "0" } },
      pool,
      { reserve0: 1_000n, reserve1: 1_000n, activeBin: null },
    ),
    null,
  );
});
test("DAMM projection preserves executable history when the liquidity baseline predates indexing", () => {
  const projected = projectPoolSwap(event, pool);
  assert.equal(projected?.side, "sell");
  assert.equal(projected?.volumeQuoteRaw, "50");
  assert.equal(projected?.spotPriceX18, "500000000000000000");
  assert.equal(projected?.reserve0After, null);
  assert.equal(projected?.reserve1After, null);
  assert.equal(projected?.state, null);
});
test("DAMM spot projection applies net input once and does not turn protocol fees into fake volatility", () => {
  const projected = projectPoolSwap(
    { ...event, payload: { ...event.payload, amountIn: "100", amountOut: "50", protocolFee: "10" } },
    pool,
    { reserve0: 1_000n, reserve1: 1_000n, activeBin: null },
  );
  assert.equal(projected?.reserve0After, "950");
  assert.equal(projected?.reserve1After, "1090");
  assert.equal(projected?.spotPriceX18, poolSpotPriceX18(pool, 950n, 1090n, null)?.toString());
});
test("DLMM direction follows canonical contract addresses even when display assets are reversed", () => {
  const swap = projectPoolSwap(
    {
      ...event,
      payload: {
        ...event.payload,
        token0ToToken1: true,
        finalActiveBin: "3",
      },
    },
    { ...pool, pool_kind: "dlmm", bin_step_bps: 25 },
  );
  assert.equal(swap?.tokenInId, "y");
  assert.equal(swap?.tokenOutId, "x");
  assert.equal(swap?.activeBin, 3);
  assert.equal(swap?.side, "buy");
  assert.ok(BigInt(swap?.spotPriceX18 ?? "0") > 0n);
});
test("shielded execution never persists a depositor-level trader identity", () => {
  const swap = projectPoolSwap(
    { ...event, payload: { ...event.payload, privateExecution: true } },
    pool,
    { reserve0: 1_000n, reserve1: 1_000n, activeBin: null },
  );
  assert.equal(swap?.trader, null);
  assert.equal(swap?.recipient, event.payload.recipient);
});
test("ambiguous quote-token orientation is rejected", () => {
  assert.equal(
    projectPoolSwap(event, { ...pool, quote_token_id: null }, {
      reserve0: 1_000n,
      reserve1: 1_000n,
      activeBin: null,
    }),
    null,
  );
});
test("missing, future or malformed timestamps cannot enter the swap chart", () => {
  for (const value of [null, "999999999999", "oops"])
    assert.equal(
      projectPoolSwap(
        { ...event, payload: { ...event.payload, blockTimestamp: value } },
        pool,
        { reserve0: 1_000n, reserve1: 1_000n, activeBin: null },
      ),
      null,
    );
});
test("reference midpoint is exact and rejects crossed or zero quotes", () => {
  assert.equal(
    quoteMidpoint("0.000000000000000001", "0.000000000000000003"),
    "0.000000000000000002",
  );
  assert.throws(() => quoteMidpoint("2", "1"));
  assert.throws(() => quoteMidpoint("0", "0"));
});
test("pool reference price applies decimal differences and actual direction", () => {
  assert.equal(poolStatePrice(2n ** 96n, true, 18, 6), "1000000000000");
  assert.equal(poolStatePrice(2n ** 96n, false, 6, 18), "0.000000000001");
  assert.throws(() => poolStatePrice(0n, true, 18, 6));
});
