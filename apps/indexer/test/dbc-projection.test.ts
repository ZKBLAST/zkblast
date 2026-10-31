import assert from "node:assert/strict";
import test from "node:test";
import type { Address, Hex } from "viem";
import { buildDbcCandles, dbcSwapFromEvent, DbcMonitor, graduationProgressBps, validateDbcEvent } from "../src/dbc-projection.js";
import type { IndexedEvent } from "../src/domain.js";

const address = (suffix: string) => `0x${suffix.padStart(40,"0")}` as Address;
const hash = (suffix: string) => `0x${suffix.padStart(64,"0")}` as Hex;
function swap(logIndex: number, timestamp: number, price: string): IndexedEvent {
  return { chainId: 4663, blockNumber: 100n + BigInt(logIndex), blockHash: hash("1"), transactionHash: hash(String(logIndex + 2)),
    logIndex, contractAddress: address("1"), kind: "launch", eventName: "CurveSwapExecuted",
    payload: { launchId: hash("a"), sender: address("2"), recipient: address("3"), isBuy: true,
      amountInRaw: "100", amountOutRaw: "10", feeRaw: "1", finalPriceX18: price,
      realQuoteReserveRaw: "100", baseSoldRaw: "10", blockTimestamp: String(timestamp) } };
}

test("DBC validation enforces chain, signature and contract allowlist", () => {
  const event = swap(0, 120, "10");
  assert.equal(validateDbcEvent(event, { chainId: 4663, allowedContracts: new Set([address("1").toLowerCase()]) }), event);
  assert.throws(() => validateDbcEvent(event, { chainId: 46630, allowedContracts: new Set([address("1").toLowerCase()]) }), /CHAIN/u);
  assert.throws(() => validateDbcEvent(event, { chainId: 4663, allowedContracts: new Set() }), /NOT_ALLOWED/u);
});

test("OHLCV uses only recorded swaps and retains real volume", () => {
  const swaps = [dbcSwapFromEvent(swap(0,120,"10"))!, dbcSwapFromEvent(swap(1,140,"15"))!, dbcSwapFromEvent(swap(2,190,"12"))!];
  const candles = buildDbcCandles(swaps, 60);
  assert.equal(candles.length, 2);
  assert.deepEqual(candles[0], { bucket: new Date(120_000), openX18: 10n, highX18: 15n, lowX18: 10n,
    closeX18: 15n, baseVolumeRaw: 20n, quoteVolumeRaw: 200n, trades: 2 });
  assert.equal(graduationProgressBps(50n,100n), 5000);
});

test("monitor exposes lag, reorg, invalid event, divergence and stuck-ready counters", () => {
  const monitor = new DbcMonitor(); monitor.reorg(); monitor.invalidEvent(); monitor.quoteDivergence();
  assert.deepEqual(monitor.snapshot(90n,100n,2), { indexedBlock: 90n, finalizedBlock: 100n, lagBlocks: 10n,
    reorgs: 1, invalidEvents: 1, quoteDivergences: 1, readyLaunches: 2 });
});
