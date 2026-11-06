import type postgres from "postgres";
import { isSupportedDatabaseSchema } from "@zkblast/config";
import type { IndexedEvent } from "./domain.js";
import {
  projectDammLiquidity,
  projectPoolSwap,
  type ProjectedPoolState,
  type SwapPool,
} from "./pool-swap-projection.js";

export async function persistPoolSwap(
  sql: postgres.Sql | postgres.TransactionSql,
  schema: string,
  event: IndexedEvent,
  options: Readonly<{ replay?: boolean }> = {},
) {
  if (!isSupportedDatabaseSchema(schema))
    throw new Error("INVALID_DATABASE_SCHEMA");
  const isSwap = event.eventName === "Swap" && event.kind === "swap";
  const isDammLiquidity =
    event.kind === "liquidity" &&
    ["LiquidityAdded", "LiquidityRemoved"].includes(event.eventName);
  if (!isSwap && !isDammLiquidity) return false;
  const pools = await sql.unsafe<SwapPool[]>(
    `select p.id,p.address,p.pool_kind,p.token_x_id,p.token_y_id,p.quote_token_id,p.bin_step_bps,
    x.address as token_x_address,x.decimals::integer as token_x_decimals,
    y.address as token_y_address,y.decimals::integer as token_y_decimals from ${schema}.pools p
    join ${schema}.assets x on x.id=p.token_x_id join ${schema}.assets y on y.id=p.token_y_id
    where p.address=$1 and p.chain_id=$2`,
    [event.contractAddress.toLowerCase(), event.chainId],
  );
  const pool = pools[0];
  if (!pool) return false;
  if (isSwap && !options.replay) {
    const existing = await sql.unsafe<{ block_hash: string }[]>(
      `select block_hash from ${schema}.swaps
       where chain_id=$1 and transaction_hash=$2 and log_index=$3 and canonical`,
      [event.chainId, event.transactionHash.toLowerCase(), event.logIndex],
    );
    if (existing[0]?.block_hash === event.blockHash.toLowerCase()) return true;
  }
  const states = await sql.unsafe<{
    reserve0_raw: string;
    reserve1_raw: string;
    active_bin: number | null;
  }[]>(
    `select reserve0_raw::text,reserve1_raw::text,active_bin
     from ${schema}.pool_state where pool_id=$1`,
    [pool.id],
  );
  const previous: ProjectedPoolState = {
    reserve0: BigInt(states[0]?.reserve0_raw ?? "0"),
    reserve1: BigInt(states[0]?.reserve1_raw ?? "0"),
    activeBin: states[0]?.active_bin ?? null,
  };
  if (isDammLiquidity) {
    const state = projectDammLiquidity(event, pool, previous);
    if (!state) return false;
    await upsertPoolState(sql, schema, event, pool.id, state);
    return true;
  }
  const swap = projectPoolSwap(event, pool, previous);
  if (!swap) return false;
  await sql.unsafe(
    `insert into ${schema}.swaps
    (pool_id,chain_id,transaction_hash,log_index,token_in_id,token_out_id,amount_in_raw,amount_out_raw,fee_raw,
     side,trader,recipient,active_bin,reserve0_after_raw,reserve1_after_raw,spot_price_x18,volume_quote_raw,
     block_number,block_hash,block_timestamp,canonical)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,true)
    on conflict (chain_id,transaction_hash,log_index) do update set
    pool_id=excluded.pool_id,token_in_id=excluded.token_in_id,token_out_id=excluded.token_out_id,
    amount_in_raw=excluded.amount_in_raw,amount_out_raw=excluded.amount_out_raw,fee_raw=excluded.fee_raw,
    side=excluded.side,trader=excluded.trader,recipient=excluded.recipient,active_bin=excluded.active_bin,
    reserve0_after_raw=excluded.reserve0_after_raw,reserve1_after_raw=excluded.reserve1_after_raw,
    spot_price_x18=excluded.spot_price_x18,volume_quote_raw=excluded.volume_quote_raw,
    block_number=excluded.block_number,block_hash=excluded.block_hash,block_timestamp=excluded.block_timestamp,canonical=true`,
    [
      swap.poolId,
      event.chainId,
      event.transactionHash.toLowerCase(),
      event.logIndex,
      swap.tokenInId,
      swap.tokenOutId,
      swap.amountIn,
      swap.amountOut,
      swap.fee,
      swap.side,
      swap.trader,
      swap.recipient,
      swap.activeBin,
      swap.reserve0After,
      swap.reserve1After,
      swap.spotPriceX18,
      swap.volumeQuoteRaw,
      event.blockNumber.toString(),
      event.blockHash.toLowerCase(),
      swap.observedAt,
    ],
  );
  if (swap.state)
    await upsertPoolState(sql, schema, event, pool.id, {
      ...swap.state,
      spotPriceX18: swap.spotPriceX18,
    });
  if (swap.spotPriceX18 && swap.volumeQuoteRaw)
    await upsertCandles(
      sql,
      schema,
      pool.id,
      event.blockNumber,
      swap.observedAt,
      swap.spotPriceX18,
      swap.volumeQuoteRaw,
    );
  return true;
}

export async function rebuildPoolProjections(
  sql: postgres.Sql | postgres.TransactionSql,
  schema: string,
  chainId: number,
) {
  if (!isSupportedDatabaseSchema(schema))
    throw new Error("INVALID_DATABASE_SCHEMA");
  await sql.unsafe(`delete from ${schema}.pool_candles`);
  await sql.unsafe(`delete from ${schema}.pool_state where chain_id=$1`, [chainId]);
  const events = await sql.unsafe<{
    transaction_hash: IndexedEvent["transactionHash"];
    log_index: number;
    block_number: string;
    block_hash: IndexedEvent["blockHash"];
    contract_address: IndexedEvent["contractAddress"];
    event_kind: IndexedEvent["kind"];
    event_name: string;
    payload: IndexedEvent["payload"];
    block_timestamp: Date | null;
  }[]>(
    `select e.transaction_hash,e.log_index,e.block_number::text,e.block_hash,e.contract_address,
            e.event_kind,e.event_name,e.payload,s.block_timestamp
     from ${schema}.protocol_events e
     left join ${schema}.swaps s on s.chain_id=e.chain_id
       and s.transaction_hash=e.transaction_hash and s.log_index=e.log_index
     where e.chain_id=$1 and e.canonical and
       ((e.event_kind='swap' and e.event_name='Swap') or
        (e.event_kind='liquidity' and e.event_name=any($2::text[])))
     order by e.block_number,e.log_index`,
    [chainId, ["LiquidityAdded", "LiquidityRemoved"]],
  );
  let projected = 0;
  for (const event of events) {
    const decodedPayload = typeof event.payload === "string"
      ? JSON.parse(event.payload) as IndexedEvent["payload"]
      : event.payload;
    if (!decodedPayload || typeof decodedPayload !== "object" || Array.isArray(decodedPayload))
      throw new Error("POOL_EVENT_PAYLOAD_INVALID");
    if (await persistPoolSwap(
      sql,
      schema,
      {
        chainId,
        transactionHash: event.transaction_hash,
        logIndex: event.log_index,
        blockNumber: BigInt(event.block_number),
        blockHash: event.block_hash,
        contractAddress: event.contract_address,
        kind: event.event_kind,
        eventName: event.event_name,
        payload: decodedPayload.blockTimestamp || !event.block_timestamp
          ? decodedPayload
          : {
              ...decodedPayload,
              blockTimestamp: Math.floor(event.block_timestamp.getTime() / 1_000).toString(),
            },
      },
      { replay: true },
    )) projected++;
  }
  return projected;
}

async function upsertPoolState(
  sql: postgres.Sql | postgres.TransactionSql,
  schema: string,
  event: IndexedEvent,
  poolId: string,
  state: ProjectedPoolState & { spotPriceX18?: string | null },
) {
  const rawTimestamp = event.payload.blockTimestamp;
  const timestamp = typeof rawTimestamp === "string" && /^\d{1,12}$/u.test(rawTimestamp)
    ? new Date(Number(BigInt(rawTimestamp)) * 1_000)
    : new Date(0);
  await sql.unsafe(
    `insert into ${schema}.pool_state
     (pool_id,chain_id,reserve0_raw,reserve1_raw,active_bin,spot_price_x18,observed_block,
      observed_block_hash,observed_log_index,observed_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict(pool_id) do update set
      chain_id=excluded.chain_id,reserve0_raw=excluded.reserve0_raw,reserve1_raw=excluded.reserve1_raw,
      active_bin=excluded.active_bin,spot_price_x18=excluded.spot_price_x18,
      observed_block=excluded.observed_block,observed_block_hash=excluded.observed_block_hash,
      observed_log_index=excluded.observed_log_index,observed_at=excluded.observed_at,updated_at=now()
     where (excluded.observed_block,excluded.observed_log_index) >=
           (${schema}.pool_state.observed_block,${schema}.pool_state.observed_log_index)`,
    [
      poolId,
      event.chainId,
      state.reserve0.toString(),
      state.reserve1.toString(),
      state.activeBin,
      state.spotPriceX18 ?? null,
      event.blockNumber.toString(),
      event.blockHash.toLowerCase(),
      event.logIndex,
      timestamp,
    ],
  );
}

async function upsertCandles(
  sql: postgres.Sql | postgres.TransactionSql,
  schema: string,
  poolId: string,
  blockNumber: bigint,
  observedAt: Date,
  priceX18: string,
  volumeQuoteRaw: string,
) {
  for (const interval of [60, 300, 900, 3600, 14400, 86400]) {
    const bucket = new Date(
      Math.floor(observedAt.getTime() / (interval * 1_000)) * interval * 1_000,
    );
    await sql.unsafe(
      `insert into ${schema}.pool_candles
       (pool_id,interval_seconds,bucket_start,open_x18,high_x18,low_x18,close_x18,
        volume_quote_raw,trade_count,first_block,last_block)
       values ($1,$2,$3,$4,$4,$4,$4,$5,1,$6,$6)
       on conflict(pool_id,interval_seconds,bucket_start) do update set
        high_x18=greatest(${schema}.pool_candles.high_x18,excluded.high_x18),
        low_x18=least(${schema}.pool_candles.low_x18,excluded.low_x18),
        close_x18=excluded.close_x18,
        volume_quote_raw=${schema}.pool_candles.volume_quote_raw+excluded.volume_quote_raw,
        trade_count=${schema}.pool_candles.trade_count+1,
        last_block=greatest(${schema}.pool_candles.last_block,excluded.last_block),updated_at=now()`,
      [poolId, interval, bucket, priceX18, volumeQuoteRaw, blockNumber.toString()],
    );
  }
}
