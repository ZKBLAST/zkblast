import assert from "node:assert/strict";
import test from "node:test";
import { chartTooltipLeft, chartTooltipValues } from "../src/lib/chart-tooltip";

const bar = { time: 0, open: 10, high: 14, low: 8, close: 12, observations: 4 };
test("line tooltip displays the recorded close, candles retain all OHLC values", () => {
  assert.deepEqual(chartTooltipValues(bar, "line"), [["Price", 12]]);
  assert.deepEqual(chartTooltipValues(bar, "candles"), [
    ["Open", 10],
    ["High", 14],
    ["Low", 8],
    ["Close", 12],
  ]);
});
test("tooltip stays inside small and large chart boundaries", () => {
  assert.equal(chartTooltipLeft(0, 280), 12);
  assert.equal(chartTooltipLeft(275, 280), 80);
  assert.equal(chartTooltipLeft(1200, 1200), 1000);
  assert.equal(chartTooltipLeft(90, 100), 8);
});
