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
  BinLiquidityAdded: "liquidity",
  BinLiquidityRemoved: "liquidity",
  ActiveBinUpdated: "pool",
  DlmmPoolInitialized: "pool",
  ProtocolFeesCollected: "fee",
  CommitmentDeposited: "commitment",
  NoteInserted: "commitment",
  IntentReserved: "private_intent",
  IntentSettled: "private_intent",
  IntentRefunded: "private_intent",
  RootRegistered: "root",
  TransactionReceipt: "receipt",
};

export function classifyProtocolEvent(
  eventName: string,
): ProtocolEventKind | null {
  return eventKinds[eventName] ?? null;
}
