import type postgres from "postgres";
import type { IndexedEvent } from "./domain.js";
import { perpEventRow, type PerpProjectionEvent } from "./perps-projection.js";

const eventKinds: Readonly<Partial<Record<string, PerpProjectionEvent["kind"]>>> = {
  MarketStatusUpdated: "market",
  MarketPauseUpdated: "market",
  FundingRateUpdated: "funding",
  PositionOpened: "open",
  PublicPositionOpened: "open",
  PositionClosed: "close",
  PublicPositionClosed: "close",
  PositionLiquidated: "liquidation",
  PublicPositionLiquidated: "liquidation",
  Redeemed: "lp_redeem",
  InsuranceFunded: "insurance",
  InsuranceCovered: "insurance",
};

function projectionKind(event: IndexedEvent): PerpProjectionEvent["kind"] | undefined {
  if (
    event.eventName === "Deposited" &&
    event.payload.assets !== undefined &&
    event.payload.shares !== undefined &&
    event.payload.sender !== undefined &&
    event.payload.recipient !== undefined
  ) return "lp_deposit";
  return eventKinds[event.eventName];
}

function text(event: IndexedEvent, key: string): string {
  const value = event.payload[key];
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`INVALID_PERPS_EVENT_${key.toUpperCase()}`);
  return value.toLowerCase();
}

function booleanValue(event: IndexedEvent, key: string): boolean {
  const value = event.payload[key];
  if (typeof value !== "boolean")
    throw new Error(`INVALID_PERPS_EVENT_${key.toUpperCase()}`);
  return value;
}

function timestamp(event: IndexedEvent): Date {
  const seconds = text(event, "blockTimestamp");
  return new Date(Number(BigInt(seconds)) * 1_000);
}

export async function persistPerpsEvent(
  sql: postgres.Sql | postgres.TransactionSql,
  schema: string,
  event: IndexedEvent,
): Promise<boolean> {
  const kind = projectionKind(event);
  if (!kind) return false;
  const marketId = event.payload.marketId ? text(event, "marketId") : undefined;
  const positionId = event.payload.positionId ? text(event, "positionId") : undefined;
  const row = perpEventRow({
    chainId: BigInt(event.chainId),
    transactionHash: event.transactionHash,
    logIndex: event.logIndex,
    blockNumber: event.blockNumber,
    blockHash: event.blockHash,
    blockTimestamp: timestamp(event),
    kind,
    ...(marketId ? { marketId: marketId as `0x${string}` } : {}),
    ...(positionId ? { positionId: positionId as `0x${string}` } : {}),
    payload: event.payload,
  });
  await sql.unsafe(
    `insert into ${schema}.perp_events
      (chain_id,transaction_hash,log_index,block_number,block_hash,block_timestamp,event_kind,market_id,position_id,payload,canonical)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,true)
     on conflict (chain_id,transaction_hash,log_index) do update set
      block_number=excluded.block_number,block_hash=excluded.block_hash,
      block_timestamp=excluded.block_timestamp,event_kind=excluded.event_kind,
      market_id=excluded.market_id,position_id=excluded.position_id,
      payload=excluded.payload,canonical=true`,
    [
      row.chain_id,
      row.transaction_hash,
      row.log_index,
      row.block_number,
      row.block_hash,
      row.block_timestamp,
      row.event_kind,
      row.market_id,
      row.position_id,
      JSON.stringify(row.payload),
    ],
  );

  if (event.eventName === "PositionOpened") {
    await sql.unsafe(
      `insert into ${schema}.perp_positions
        (position_id,market_id,owner_commitment,is_long,margin_raw,notional_raw,base_size_raw,
         entry_price_x18,funding_index_x18,status,opened_transaction_hash,opened_block,opened_at)
       select $1,$2,$3,$4,$5,$6,$7,$8,0,'open',$9,$10,$11
       where exists (select 1 from ${schema}.perp_markets where market_id=$2)
       on conflict (position_id) do update set
        market_id=excluded.market_id,owner_commitment=excluded.owner_commitment,
        is_long=excluded.is_long,margin_raw=excluded.margin_raw,notional_raw=excluded.notional_raw,
        base_size_raw=excluded.base_size_raw,entry_price_x18=excluded.entry_price_x18,
        status='open',opened_transaction_hash=excluded.opened_transaction_hash,
        opened_block=excluded.opened_block,opened_at=excluded.opened_at,updated_at=now()`,
      [
        positionId ?? null,
        marketId ?? null,
        text(event, "ownerCommitment"),
        booleanValue(event, "isLong"),
        text(event, "marginUsd"),
        text(event, "notionalUsd"),
        text(event, "baseSize"),
        text(event, "executionPriceX18"),
        event.transactionHash.toLowerCase(),
        event.blockNumber.toString(),
        row.block_timestamp,
      ],
    );
  } else if (event.eventName === "PublicPositionOpened") {
    await sql.unsafe(
      `update ${schema}.perp_positions set public_owner_address=$2,updated_at=now()
       where position_id=$1 and status='open'`,
      [positionId ?? null, text(event, "owner")],
    );
  } else if (event.eventName === "PositionClosed" || event.eventName === "PositionLiquidated") {
    await sql.unsafe(
      `update ${schema}.perp_positions set status=$2,closed_transaction_hash=$3,
       closed_block=$4,closed_at=$5,updated_at=now() where position_id=$1`,
      [
        positionId ?? null,
        event.eventName === "PositionClosed" ? "closed" : "liquidated",
        event.transactionHash.toLowerCase(),
        event.blockNumber.toString(),
        row.block_timestamp,
      ],
    );
  } else if (event.eventName === "MarketStatusUpdated") {
    await sql.unsafe(
      `update ${schema}.perp_markets set enabled=$2,updated_block=$3,updated_at=now() where market_id=$1`,
      [marketId ?? null, booleanValue(event, "enabled"), event.blockNumber.toString()],
    );
  } else if (event.eventName === "MarketPauseUpdated") {
    await sql.unsafe(
      `update ${schema}.perp_markets set paused=$2,updated_block=$3,updated_at=now() where market_id=$1`,
      [marketId ?? null, booleanValue(event, "paused"), event.blockNumber.toString()],
    );
  } else if (event.eventName === "Deposited" || event.eventName === "Redeemed") {
    const account = text(event, event.eventName === "Deposited" ? "recipient" : "owner");
    await sql.unsafe(
      `insert into ${schema}.perp_lp_activity
        (chain_id,transaction_hash,log_index,block_number,block_hash,account,event_kind,assets_raw,shares_raw,observed_at,canonical)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)
       on conflict (chain_id,transaction_hash,log_index) do update set
        block_number=excluded.block_number,block_hash=excluded.block_hash,account=excluded.account,
        event_kind=excluded.event_kind,assets_raw=excluded.assets_raw,shares_raw=excluded.shares_raw,
        observed_at=excluded.observed_at,canonical=true`,
      [event.chainId,event.transactionHash.toLowerCase(),event.logIndex,event.blockNumber.toString(),
        event.blockHash.toLowerCase(),account,event.eventName === "Deposited" ? "deposit" : "redeem",
        text(event,"assets"),text(event,"shares"),row.block_timestamp],
    );
  } else if (event.eventName === "InsuranceFunded" || event.eventName === "InsuranceCovered") {
    await sql.unsafe(
      `insert into ${schema}.perp_insurance_activity
        (chain_id,transaction_hash,log_index,block_number,block_hash,event_kind,account,amount_raw,observed_at,canonical)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)
       on conflict (chain_id,transaction_hash,log_index) do update set
        block_number=excluded.block_number,block_hash=excluded.block_hash,event_kind=excluded.event_kind,
        account=excluded.account,amount_raw=excluded.amount_raw,observed_at=excluded.observed_at,canonical=true`,
      [event.chainId,event.transactionHash.toLowerCase(),event.logIndex,event.blockNumber.toString(),
        event.blockHash.toLowerCase(),event.eventName === "InsuranceFunded" ? "funded" : "covered",
        text(event,event.eventName === "InsuranceFunded" ? "sender" : "recipient"),
        text(event,"amount"),row.block_timestamp],
    );
  }
  return true;
}
