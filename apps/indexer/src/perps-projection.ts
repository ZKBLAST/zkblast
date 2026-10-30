export type PerpProjectionEvent = Readonly<{
  chainId: bigint;
  transactionHash: `0x${string}`;
  logIndex: number;
  blockNumber: bigint;
  blockHash: `0x${string}`;
  blockTimestamp: Date;
  kind:
    | "market"
    | "funding"
    | "open"
    | "close"
    | "liquidation"
    | "lp_deposit"
    | "lp_redeem"
    | "insurance";
  marketId?: `0x${string}`;
  positionId?: `0x${string}`;
  payload: Readonly<Record<string, string | number | boolean | null>>;
}>;

export type PerpEventRow = Readonly<{
  chain_id: string;
  transaction_hash: string;
  log_index: number;
  block_number: string;
  block_hash: string;
  block_timestamp: Date;
  event_kind: PerpProjectionEvent["kind"];
  market_id: string | null;
  position_id: string | null;
  payload: PerpProjectionEvent["payload"];
  canonical: true;
}>;

/** Converts a validated canonical chain event into the database projection boundary. */
export function perpEventRow(event: PerpProjectionEvent): PerpEventRow {
  if (event.logIndex < 0 || !Number.isInteger(event.logIndex)) {
    throw new Error("Invalid Perps log index");
  }
  return {
    chain_id: event.chainId.toString(),
    transaction_hash: event.transactionHash.toLowerCase(),
    log_index: event.logIndex,
    block_number: event.blockNumber.toString(),
    block_hash: event.blockHash.toLowerCase(),
    block_timestamp: event.blockTimestamp,
    event_kind: event.kind,
    market_id: event.marketId?.toLowerCase() ?? null,
    position_id: event.positionId?.toLowerCase() ?? null,
    payload: event.payload,
    canonical: true,
  };
}
