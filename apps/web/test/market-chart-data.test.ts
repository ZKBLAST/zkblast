import assert from "node:assert/strict";
import test from "node:test";
import { marketCandles } from "../src/lib/market-chart-data";
import type { MarketPricePoint } from "../src/types/application";

const point = (time: number, price: string): MarketPricePoint => ({
  source: "swap",
  observedAt: new Date(time * 1000).toISOString(),
  price,
  volume: null,
  blockNumber: null,
  transactionHash: null,
});
test("candles preserve real opening/closing order and do not fill empty intervals", () => {
  const bars = marketCandles(
    [point(120, "8"), point(30, "4"), point(10, "2"), point(40, "1")],
    "1m",
  );
  assert.deepEqual(bars, [
    { time: 0, open: 2, high: 4, low: 1, close: 1, observations: 3 },
    { time: 120, open: 8, high: 8, low: 8, close: 8, observations: 1 },
  ]);
});
test("reciprocal charts exchange high/low without using wrong OHLC bounds", () => {
  const bars = marketCandles(
    [point(10, "2"), point(30, "4"), point(40, "1")],
    "1m",
    true,
  );
  assert.deepEqual(bars[0], {
    time: 0,
    open: 0.5,
    high: 1,
    low: 0.25,
    close: 1,
    observations: 3,
  });
});
test("invalid prices and dates are excluded without creating a placeholder candle", () => {
  assert.deepEqual(
    marketCandles(
      [
        point(10, "0"),
        point(20, "-1"),
        point(30, "Infinity"),
        { ...point(30, "2"), observedAt: "invalid" },
      ],
      "1m",
    ),
    [],
  );
});
