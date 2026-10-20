import assert from "node:assert/strict";
import test from "node:test";
import { resolveChartSource } from "../src/lib/resolve-chart-source";
import type { MarketPricePoint } from "../src/types/application";

const point: MarketPricePoint = {
  source: "oracle",
  observedAt: new Date().toISOString(),
  price: "1",
  volume: null,
  blockNumber: null,
  transactionHash: null,
};

test("automatic selection prefers available oracle observations", async () => {
  const calls: string[] = [];
  const result = await resolveChartSource("auto", async (source) => {
    calls.push(source);
    return [point];
  });
  assert.equal(result.source, "oracle");
  assert.deepEqual(calls, ["oracle"]);
});

test("empty oracle selects reference without mixing sources", async () => {
  const calls: string[] = [];
  const result = await resolveChartSource("auto", async (source) => {
    calls.push(source);
    return source === "reference" ? [{ ...point, source }] : [];
  });
  assert.equal(result.source, "reference");
  assert.deepEqual(calls, ["oracle", "reference"]);
  assert.equal(result.items[0]?.source, "reference");
});

test("explicit selections never fall back", async () => {
  for (const source of ["swap", "oracle", "reference"] as const) {
    const calls: string[] = [];
    const result = await resolveChartSource(source, async (selected) => {
      calls.push(selected);
      return [];
    });
    assert.equal(result.source, source);
    assert.deepEqual(calls, [source]);
  }
});

test("provider errors are not disguised as missing oracle data", async () => {
  await assert.rejects(
    resolveChartSource("auto", async () => {
      throw new Error("UNAVAILABLE");
    }),
    /UNAVAILABLE/,
  );
});
