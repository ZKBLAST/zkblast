import type { Address, Hex } from "viem";

export type ProtocolEventKind =
  "pool" | "swap" | "position" | "liquidity" | "fee" | "receipt";
export type IndexedEvent = Readonly<{
  chainId: number;
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  logIndex: number;
  contractAddress: Address;
  kind: ProtocolEventKind;
  eventName: string;
  payload: Readonly<Record<string, string | number | boolean | null>>;
}>;
export type BlockEnvelope = Readonly<{
  number: bigint;
  hash: Hex;
  parentHash: Hex;
  events: readonly IndexedEvent[];
}>;
export type IndexerCheckpoint = Readonly<{
  chainId: number;
  blockNumber: bigint;
  blockHash: Hex;
  finalizedBlock: bigint;
}>;

export const eventIdentity = (event: IndexedEvent): string =>
  `${event.chainId}:${event.transactionHash.toLowerCase()}:${event.logIndex}`;
