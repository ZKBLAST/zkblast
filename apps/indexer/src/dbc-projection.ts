import { getAddress, isHash, type Hex } from "viem";
import type { IndexedEvent } from "./domain.js";

export const dbcEventNames = new Set([
  "Transfer",
  "LaunchTemplateCreated", "LaunchTemplateStatusUpdated", "TokenLaunched",
  "LaunchMetadataPublished", "CurveSwapExecuted", "FeeAccrued", "FeeClaimed",
  "LifecycleUpdated", "GraduationReady", "GraduationCompleted",
  "AllocationRegistered", "AllocationClaimed",
]);

export type DbcSwap = Readonly<{
  id: string; launchId: Hex; blockNumber: bigint; observedAt: Date; isBuy: boolean;
  quoteAmountRaw: bigint; baseAmountRaw: bigint; feeRaw: bigint; priceX18: bigint;
}>;
export type DbcCandle = Readonly<{
  bucket: Date; openX18: bigint; highX18: bigint; lowX18: bigint; closeX18: bigint;
  baseVolumeRaw: bigint; quoteVolumeRaw: bigint; trades: number;
}>;

function text(event: IndexedEvent, key: string): string {
  const value = event.payload[key];
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`INVALID_DBC_${key.toUpperCase()}`);
  return value;
}
function uint(event: IndexedEvent, key: string): bigint {
  const value = text(event, key);
  if (!/^\d+$/u.test(value)) throw new Error(`INVALID_DBC_${key.toUpperCase()}`);
  return BigInt(value);
}
function hash(event: IndexedEvent, key: string): Hex {
  const value = text(event, key);
  if (!isHash(value)) throw new Error(`INVALID_DBC_${key.toUpperCase()}`);
  return value.toLowerCase() as Hex;
}
function timestamp(event: IndexedEvent): Date {
  return new Date(Number(uint(event, "blockTimestamp")) * 1_000);
}

export function validateDbcEvent(
  event: IndexedEvent,
  input: Readonly<{ chainId: number; allowedContracts: ReadonlySet<string> }>,
): IndexedEvent {
  if (event.kind !== "launch" || !dbcEventNames.has(event.eventName))
    throw new Error("DBC_EVENT_SIGNATURE_NOT_ALLOWED");
  if (event.chainId !== input.chainId) throw new Error("DBC_CHAIN_MISMATCH");
  const contract = getAddress(event.contractAddress).toLowerCase();
  if (!input.allowedContracts.has(contract)) throw new Error("DBC_CONTRACT_NOT_ALLOWED");
  timestamp(event);
  return event;
}

export function dbcSwapFromEvent(event: IndexedEvent): DbcSwap | null {
  if (event.eventName !== "CurveSwapExecuted") return null;
  const isBuy = event.payload.isBuy;
  if (typeof isBuy !== "boolean") throw new Error("INVALID_DBC_ISBUY");
  const amountIn = uint(event, "amountInRaw");
  const amountOut = uint(event, "amountOutRaw");
  return {
    id: `${event.chainId}:${event.transactionHash.toLowerCase()}:${event.logIndex}`,
    launchId: hash(event, "launchId"), blockNumber: event.blockNumber,
    observedAt: timestamp(event), isBuy,
    quoteAmountRaw: isBuy ? amountIn : amountOut,
    baseAmountRaw: isBuy ? amountOut : amountIn,
    feeRaw: uint(event, "feeRaw"), priceX18: uint(event, "finalPriceX18"),
  };
}

export function buildDbcCandles(
  swaps: readonly DbcSwap[], intervalSeconds: 60 | 300 | 900 | 3600 | 86400,
): DbcCandle[] {
  const intervalMs = intervalSeconds * 1_000;
  const groups = new Map<number, DbcSwap[]>();
  for (const swap of swaps) {
    const key = Math.floor(swap.observedAt.getTime() / intervalMs) * intervalMs;
    const group = groups.get(key) ?? [];
    group.push(swap); groups.set(key, group);
  }
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([bucket, group]) => {
    group.sort((a, b) => Number(a.blockNumber - b.blockNumber) || a.id.localeCompare(b.id));
    const first = group[0]!; const last = group[group.length - 1]!;
    let high = first.priceX18; let low = first.priceX18;
    let baseVolume = 0n; let quoteVolume = 0n;
    for (const swap of group) {
      if (swap.priceX18 > high) high = swap.priceX18;
      if (swap.priceX18 < low) low = swap.priceX18;
      baseVolume += swap.baseAmountRaw; quoteVolume += swap.quoteAmountRaw;
    }
    return { bucket: new Date(bucket), openX18: first.priceX18, highX18: high,
      lowX18: low, closeX18: last.priceX18, baseVolumeRaw: baseVolume,
      quoteVolumeRaw: quoteVolume, trades: group.length };
  });
}

export function graduationProgressBps(reserveRaw: bigint, thresholdRaw: bigint): number {
  if (reserveRaw < 0n || thresholdRaw <= 0n) throw new Error("INVALID_DBC_PROGRESS");
  const progress = (reserveRaw * 10_000n) / thresholdRaw;
  return Number(progress > 10_000n ? 10_000n : progress);
}

export type DbcIndexerHealth = Readonly<{
  indexedBlock: bigint; finalizedBlock: bigint; lagBlocks: bigint; reorgs: number;
  invalidEvents: number; quoteDivergences: number; readyLaunches: number;
}>;

export class DbcMonitor {
  private reorgs = 0; private invalidEvents = 0; private quoteDivergences = 0;
  reorg(): void { this.reorgs += 1; }
  invalidEvent(): void { this.invalidEvents += 1; }
  quoteDivergence(): void { this.quoteDivergences += 1; }
  snapshot(indexedBlock: bigint, finalizedBlock: bigint, readyLaunches: number): DbcIndexerHealth {
    return { indexedBlock, finalizedBlock, lagBlocks: finalizedBlock > indexedBlock ? finalizedBlock - indexedBlock : 0n,
      reorgs: this.reorgs, invalidEvents: this.invalidEvents,
      quoteDivergences: this.quoteDivergences, readyLaunches };
  }
}
