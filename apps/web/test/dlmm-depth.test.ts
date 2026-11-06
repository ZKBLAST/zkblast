import assert from "node:assert/strict";
import test from "node:test";
import { dlmmDepthRows } from "../src/lib/dlmm-depth";

const bin = (binId: number, reserve0: string, reserve1: string, priceX18: string) => ({
  binId, reserve0, reserve1, priceX18,
});

test("DLMM depth handles empty and sparse ranges without inventing bins", () => {
  assert.deepEqual(dlmmDepthRows([], 0, 6, 6), []);
  const rows = dlmmDepthRows([
    bin(-50, "1000000", "0", "500000000000000000"),
    bin(0, "1000000", "1000000", "1000000000000000000"),
    bin(80, "0", "2000000", "2000000000000000000"),
  ], 0, 6, 6);
  assert.deepEqual(rows.map((row) => row.binId), [-50, 0, 80]);
  assert.deepEqual(rows.map((row) => row.side), ["bid", "active", "ask"]);
});

test("DLMM depth keeps cumulative totals ordered away from the active bin", () => {
  const rows = dlmmDepthRows([
    bin(-2, "1000000", "0", "500000000000000000"),
    bin(-1, "1000000", "0", "750000000000000000"),
    bin(1, "0", "1000000", "1250000000000000000"),
    bin(2, "0", "1000000", "1500000000000000000"),
  ], 0, 6, 6);
  assert.ok(rows[0]!.cumulative > rows[1]!.cumulative);
  assert.ok(rows[3]!.cumulative > rows[2]!.cumulative);
});

test("DLMM depth supports inverted display units and rejects extreme invalid prices", () => {
  const direct = dlmmDepthRows([bin(0, "2000000", "3000000", "2000000000000000000")], 0, 6, 6);
  const inverted = dlmmDepthRows([bin(0, "2000000", "3000000", "2000000000000000000")], 0, 6, 6, true);
  assert.equal(direct[0]?.price, 2);
  assert.equal(inverted[0]?.price, 0.5);
  assert.equal(inverted[0]?.base, 3);
  assert.deepEqual(dlmmDepthRows([bin(0, "1", "1", "0")], 0, 18, 18), []);
});
