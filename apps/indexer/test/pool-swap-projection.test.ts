import assert from "node:assert/strict";
import test from "node:test";
import { projectPoolSwap, type SwapPool } from "../src/pool-swap-projection.js";
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
    blockTimestamp: "1700000000",
  },
} as unknown as IndexedEvent;
test("DAMM projection validates direction and positive amounts", () => {
  assert.equal(projectPoolSwap(event, pool)?.tokenInId, "x");
  assert.equal(
    projectPoolSwap(
      { ...event, payload: { ...event.payload, tokenIn: pool.address } },
      pool,
    ),
    null,
  );
  assert.equal(
    projectPoolSwap(
      { ...event, payload: { ...event.payload, amountOut: "0" } },
      pool,
    ),
    null,
  );
});
test("DLMM direction follows canonical contract addresses even when display assets are reversed", () => {
  const swap = projectPoolSwap(
    { ...event, payload: { ...event.payload, token0ToToken1: true } },
    { ...pool, pool_kind: "dlmm" },
  );
  assert.equal(swap?.tokenInId, "y");
  assert.equal(swap?.tokenOutId, "x");
});
test("missing, future or malformed timestamps cannot enter the swap chart", () => {
  for (const value of [null, "999999999999", "oops"])
    assert.equal(
      projectPoolSwap(
        { ...event, payload: { ...event.payload, blockTimestamp: value } },
        pool,
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
