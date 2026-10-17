import type { ProtocolEventKind } from "./domain.js";

const eventKinds: Readonly<Record<string, ProtocolEventKind>> = {
  PoolCreated: "pool",
  Swap: "swap",
  SwapRouted: "swap",
  PositionCreated: "position",
  PositionIncreased: "liquidity",
  PositionDecreased: "liquidity",
  PositionTransferred: "position",
  LiquidityAdded: "liquidity",
  LiquidityRemoved: "liquidity",
  ProtocolFeesCollected: "fee",
  TransactionReceipt: "receipt",
};

export function classifyProtocolEvent(
  eventName: string,
): ProtocolEventKind | null {
  return eventKinds[eventName] ?? null;
}
