import assert from "node:assert/strict";
import test from "node:test";
import {
  marketCandles,
  marketVolumes,
  chartRangeHours,
  chartRangeForInterval,
  chartIntervals,
} from "../src/lib/market-chart-data";
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

test("minute windows have their actual duration", () => {
  assert.equal(chartRangeHours["5m"] * 60, 5);
  assert.equal(chartRangeHours["15m"] * 60, 15);
  assert.equal(chartRangeHours["30m"] * 60, 30);
});

test("one selected candle interval determines the history window automatically", () => {
  assert.equal(chartIntervals["30m"], 1800);
  assert.equal(chartRangeForInterval["1m"], "1D");
  assert.equal(chartRangeForInterval["5m"], "1W");
  assert.equal(chartRangeForInterval["1h"], "1M");
});

test("volume aggregates real swap quote amounts and converts per trade when inverted", () => {
  const trades = [
    { ...point(10, "2"), volume: "6" },
    { ...point(20, "4"), volume: "8" },
  ];
  assert.equal(marketVolumes(trades, "1m")[0]?.value, 14);
  assert.equal(marketVolumes(trades, "1m", true)[0]?.value, 5);
  assert.deepEqual(
    marketVolumes([{ ...trades[0]!, source: "oracle" }], "1m"),
    [],
  );
  assert.deepEqual(
    marketVolumes([{ ...trades[0]!, source: "reference" }], "1m"),
    [],
  );
  assert.deepEqual(marketVolumes([{ ...trades[0]!, volume: "-1" }], "1m"), []);
  assert.deepEqual(marketVolumes([point(10, "2")], "1m"), []);
});
