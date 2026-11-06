import postgres from "postgres";
import { isSupportedDatabaseSchema } from "@zkblast/config";
import { z } from "zod";
import type {
  PageQuery,
  PoolChartQuery,
  ProtocolReadStore,
} from "./protocol-service.js";


export class PostgresProtocolReadStore implements ProtocolReadStore {
  private readonly sql;
  private readonly schema: string;

  constructor(databaseUrl: string, schema: string) {
    if (!isSupportedDatabaseSchema(schema)) throw new Error("INVALID_DATABASE_SCHEMA");
    this.schema = schema;
    this.sql = postgres(databaseUrl, {
      max: 1,
      prepare: false,
      idle_timeout: 10,
    });
  }

  pools(query: PageQuery) {
    return this.sql.unsafe(
      `select p.chain_id::integer as "chainId", p.address, p.pool_kind as model, p.fee_bps as "feeBps", p.status, p.created_block as "createdBlock", x.address as "token0Address", x.symbol as "token0Symbol", x.decimals as "token0Decimals", y.address as "token1Address", y.symbol as "token1Symbol", y.decimals as "token1Decimals" from ${this.schema}.pools p join ${this.schema}.assets x on x.id=p.token_x_id join ${this.schema}.assets y on y.id=p.token_y_id where ($1::text is null or p.address > $1) order by p.address asc limit $2`,
      [query.cursor ?? null, query.limit],
    );
  }
  swaps(query: PageQuery) {
    return this.sql.unsafe(
      `select chain_id, transaction_hash, log_index, amount_in_raw::text, amount_out_raw::text, fee_raw::text, block_number, block_timestamp from ${this.schema}.swaps where canonical and ($1::text is null or transaction_hash < $1) order by block_number desc, log_index desc limit $2`,
      [query.cursor ?? null, query.limit],
    );
  }
  activity(query: PageQuery) {
    return this.sql.unsafe(
      `select chain_id as "chainId",transaction_hash as "transactionHash",log_index as "logIndex",block_number::text as "blockNumber",contract_address as "contractAddress",event_kind as kind,event_name as "eventName",payload from ${this.schema}.protocol_events where canonical and event_kind <> 'receipt' and ($1::text is null or transaction_hash < $1) and ($2::text is null or lower(payload->>'transactionSender')=$2) order by block_number desc,log_index desc limit $3`,
      [query.cursor ?? null, query.owner ?? null, query.limit],
    );
  }
  async priceHistory(pool: string, query: PoolChartQuery) {
    const rows = await this.sql.unsafe(
      `select * from (
        select 'swap' as source, s.block_timestamp as "observedAt",
        (s.spot_price_x18/power(10::numeric,18))::text as price,
        (s.volume_quote_raw/power(10::numeric,q.decimals))::text as volume,
        q.symbol as "priceUnit", s.block_number::text as "blockNumber",s.transaction_hash as "transactionHash"
        from ${this.schema}.swaps s join ${this.schema}.pools p on p.id=s.pool_id
        join ${this.schema}.assets q on q.id=p.quote_token_id
        where p.address=$1 and s.canonical and s.spot_price_x18>0 and s.volume_quote_raw>=0
        and ((s.token_in_id=p.token_x_id and s.token_out_id=p.token_y_id)
          or (s.token_in_id=p.token_y_id and s.token_out_id=p.token_x_id))
        and s.block_timestamp >= $2 and s.block_timestamp <= $3
        order by s.block_timestamp desc,s.block_number desc,s.log_index desc limit $4
      ) observations order by "observedAt" asc,"blockNumber"::numeric asc`,
      [pool, query.from, query.to, query.limit],
    );
    return rows.map((row) => ({
      ...row,
      observedAt: z.coerce.date().parse(row.observedAt).toISOString(),
    }));
  }
  async poolCandles(pool: string, query: import("./protocol-service.js").PoolCandleQuery) {
    const rows = await this.sql.unsafe(
      `select c.bucket_start as "observedAt",
        (c.open_x18/power(10::numeric,18))::text open,
        (c.high_x18/power(10::numeric,18))::text high,
        (c.low_x18/power(10::numeric,18))::text low,
        (c.close_x18/power(10::numeric,18))::text close,
        (c.volume_quote_raw/power(10::numeric,q.decimals))::text volume,
        c.trade_count as "tradeCount",q.symbol as "priceUnit",
        c.first_block::text as "firstBlock",c.last_block::text as "lastBlock"
       from ${this.schema}.pool_candles c
       join ${this.schema}.pools p on p.id=c.pool_id
       join ${this.schema}.assets q on q.id=p.quote_token_id
       where p.address=$1 and c.interval_seconds=$2
         and c.bucket_start >= $3 and c.bucket_start <= $4
       order by c.bucket_start desc limit $5`,
      [pool, query.intervalSeconds, query.from, query.to, query.limit],
    );
    return rows.reverse().map((row) => ({
      ...row,
      observedAt: z.coerce.date().parse(row.observedAt).toISOString(),
    }));
  }
  async poolStats(pool: string) {
    const rows = await this.sql.unsafe(
      `select p.address,p.pool_kind as model,p.fee_bps as "feeBps",
        q.symbol as "priceUnit",q.decimals::integer as "quoteDecimals",
        x.address as "tokenXAddress",x.decimals::integer as "tokenXDecimals",
        y.address as "tokenYAddress",y.decimals::integer as "tokenYDecimals",
        q.address as "quoteAddress",state.spot_price_x18::text as "spotPriceX18",
        state.reserve0_raw::text as "reserve0Raw",state.reserve1_raw::text as "reserve1Raw",
        state.active_bin as "activeBin",state.observed_block::text as "asOfBlock",
        state.observed_at as "observedAt",
        greatest(0,extract(epoch from (now()-p.created_at)))::bigint::text as "poolAgeSeconds",
        price_window.first_price::text as "firstPrice24hX18",
        price_window.last_price::text as "lastPrice24hX18",
        coalesce(jsonb_object_agg(w.label,jsonb_build_object(
          'volumeQuoteRaw',w.volume_quote_raw::text,'tradeCount',w.trade_count,
          'buyCount',w.buy_count,'sellCount',w.sell_count,
          'buyVolumeRaw',w.buy_volume_raw::text,'sellVolumeRaw',w.sell_volume_raw::text,
          'traderCount',w.trader_count,'netBuyRaw',(w.buy_volume_raw-w.sell_volume_raw)::text
        )) filter(where w.label is not null),'{}'::jsonb) windows
       from ${this.schema}.pools p
       join ${this.schema}.assets x on x.id=p.token_x_id
       join ${this.schema}.assets y on y.id=p.token_y_id
       join ${this.schema}.assets q on q.id=p.quote_token_id
       left join ${this.schema}.pool_state state on state.pool_id=p.id
       left join lateral (
         select
           (array_agg(s.spot_price_x18 order by s.block_number,s.log_index))[1] first_price,
           (array_agg(s.spot_price_x18 order by s.block_number desc,s.log_index desc))[1] last_price
         from ${this.schema}.swaps s where s.pool_id=p.id and s.canonical
           and s.spot_price_x18>0 and s.block_timestamp>=now()-interval '24 hours'
       ) price_window on true
       left join lateral (
         select win.label,
          coalesce(sum(s.volume_quote_raw),0) volume_quote_raw,count(s.id)::integer trade_count,
          count(*) filter(where s.side='buy')::integer buy_count,
          count(*) filter(where s.side='sell')::integer sell_count,
          coalesce(sum(s.volume_quote_raw) filter(where s.side='buy'),0) buy_volume_raw,
          coalesce(sum(s.volume_quote_raw) filter(where s.side='sell'),0) sell_volume_raw,
          count(distinct s.trader) filter(where s.trader is not null)::integer trader_count
         from (values ('5m',interval '5 minutes'),('1h',interval '1 hour'),
                      ('6h',interval '6 hours'),('24h',interval '24 hours')) win(label,duration)
         left join ${this.schema}.swaps s on s.pool_id=p.id and s.canonical
           and s.block_timestamp>=now()-win.duration
         group by win.label
       ) w on true
       where p.address=$1
       group by p.id,x.id,y.id,q.id,state.pool_id,price_window.first_price,price_window.last_price`,
      [pool],
    );
    const row = rows[0];
    if (!row) return null;
    const windows = row.windows as Record<string, { volumeQuoteRaw: string }>;
    const volume24hRaw = BigInt(windows["24h"]?.volumeQuoteRaw ?? "0");
    const fee24hRaw = volume24hRaw * BigInt(row.feeBps) / 10_000n;
    const tvlQuoteRaw = row.model === "damm" && row.spotPriceX18
      ? dammTvlQuoteRaw(row as unknown as DammStatsRow)
      : null;
    const firstPrice = row.firstPrice24hX18 ? BigInt(row.firstPrice24hX18) : null;
    const lastPrice = row.lastPrice24hX18 ? BigInt(row.lastPrice24hX18) : null;
    return {
      ...row,
      observedAt: row.observedAt ? z.coerce.date().parse(row.observedAt).toISOString() : null,
      priceKind: "pool",
      tvlQuoteRaw: tvlQuoteRaw?.toString() ?? null,
      tvlCoverage: row.model === "damm" ? "full_pool" : "requires_dlmm_lens",
      fee24hRaw: fee24hRaw.toString(),
      feesToTvlBps: tvlQuoteRaw && tvlQuoteRaw > 0n
        ? (fee24hRaw * 10_000n / tvlQuoteRaw).toString()
        : null,
      priceChange24hBps: firstPrice && lastPrice
        ? ((lastPrice - firstPrice) * 10_000n / firstPrice).toString()
        : null,
    };
  }
  async poolTrades(pool: string, query: PageQuery) {
    return this.sql.unsafe(
      `select s.transaction_hash as "transactionHash",s.log_index as "logIndex",
        s.block_number::text as "blockNumber",s.block_timestamp as "observedAt",
        s.side,
        case when coalesce((e.payload::jsonb->>'privateExecution')::boolean,false)
          then null else s.trader end as trader,
        case when coalesce((e.payload::jsonb->>'privateExecution')::boolean,false)
          then null else s.recipient end as recipient,
        case
          when coalesce((e.payload::jsonb->>'privateExecution')::boolean,false) then 'shielded'
          when s.trader is null then 'unattributed'
          else 'public'
        end as privacy,
        s.amount_in_raw::text as "amountInRaw",
        s.amount_out_raw::text as "amountOutRaw",s.volume_quote_raw::text as "volumeQuoteRaw",
        (s.spot_price_x18/power(10::numeric,18))::text price,
        ti.symbol as "tokenInSymbol",tout.symbol as "tokenOutSymbol",q.symbol as "priceUnit"
       from ${this.schema}.swaps s join ${this.schema}.pools p on p.id=s.pool_id
       left join ${this.schema}.protocol_events e on e.chain_id=s.chain_id
         and e.transaction_hash=s.transaction_hash and e.log_index=s.log_index and e.canonical
       join ${this.schema}.assets ti on ti.id=s.token_in_id
       join ${this.schema}.assets tout on tout.id=s.token_out_id
       join ${this.schema}.assets q on q.id=p.quote_token_id
       where p.address=$1 and s.canonical and
         ($2::text is null or (s.block_number,s.transaction_hash,s.log_index)<
          (split_part($2,':',1)::bigint,split_part($2,':',2),split_part($2,':',3)::integer))
       order by s.block_number desc,s.transaction_hash desc,s.log_index desc limit $3`,
      [pool, query.cursor ?? null, query.limit],
    );
  }
  positions(query: PageQuery) {
    return this.sql.unsafe(
      `select p.onchain_position_id as "onchainPositionId", p.liquidity_raw::text as "liquidityRaw", p.lower_bound as "lowerBound", p.upper_bound as "upperBound", p.status, p.opened_at as "openedAt", p.closed_at as "closedAt", p.updated_at as "updatedAt", pools.address as "poolAddress", pools.pool_kind as model, x.symbol as "token0Symbol", y.symbol as "token1Symbol" from ${this.schema}.positions p join ${this.schema}.user_wallets w on w.id=p.wallet_id join ${this.schema}.pools pools on pools.id=p.pool_id join ${this.schema}.assets x on x.id=pools.token_x_id join ${this.schema}.assets y on y.id=pools.token_y_id where ($1::text is null or p.onchain_position_id > $1) and ($2::text is null or w.wallet_address=$2) order by p.onchain_position_id asc limit $3`,
      [query.cursor ?? null, query.owner ?? null, query.limit],
    );
  }
  positionAccounting(owner: string) {
    return this.sql.unsafe(
      `select p.onchain_position_id as "onchainPositionId", pools.address as "poolAddress",
        coalesce(sum(case when e.action='deposit' then e.amount0_raw else -e.amount0_raw end),0)::text as "netContributed0Raw",
        coalesce(sum(case when e.action='deposit' then e.amount1_raw else -e.amount1_raw end),0)::text as "netContributed1Raw",
        coalesce(sum(e.amount0_raw) filter(where e.action='deposit'),0)::text as "lifetimeDeposited0Raw",
        coalesce(sum(e.amount1_raw) filter(where e.action='deposit'),0)::text as "lifetimeDeposited1Raw",
        coalesce(sum(e.amount0_raw) filter(where e.action='withdrawal'),0)::text as "lifetimeWithdrawn0Raw",
        coalesce(sum(e.amount1_raw) filter(where e.action='withdrawal'),0)::text as "lifetimeWithdrawn1Raw"
       from ${this.schema}.positions p
       join ${this.schema}.user_wallets w on w.id=p.wallet_id
       join ${this.schema}.pools pools on pools.id=p.pool_id
       join ${this.schema}.position_accounting_events e on e.pool_id=p.pool_id
         and e.onchain_position_id=p.onchain_position_id::numeric and e.canonical
       where w.wallet_address=$1
       group by p.id,pools.address order by p.onchain_position_id`,
      [owner],
    );
  }

  async indexerStatus() {
    const rows = await this.sql.unsafe(
      `select last_processed_block, finalized_block, updated_at from ${this.schema}.ingestion_checkpoints where consumer='protocol' order by updated_at desc limit 1`,
    );
    const row = rows[0] as
      | {
          last_processed_block: string;
          finalized_block: string;
          updated_at: Date;
        }
      | undefined;
    return row
      ? {
          indexedBlock: BigInt(row.last_processed_block),
          finalizedBlock: BigInt(row.finalized_block),
          updatedAt: row.updated_at,
        }
      : null;
  }

  async recentFailedTransactions() {
    const rows = await this.sql.unsafe(
      `select count(*)::integer as count from ${this.schema}.transactions where status in ('reverted', 'replaced', 'dropped') and updated_at >= now() - interval '15 minutes'`,
    );
    return Number((rows[0] as { count?: number } | undefined)?.count ?? 0);
  }
}

type DammStatsRow = Readonly<{
  tokenXAddress: string;
  tokenYAddress: string;
  quoteAddress: string;
  tokenXDecimals: number;
  tokenYDecimals: number;
  quoteDecimals: number;
  reserve0Raw: string | null;
  reserve1Raw: string | null;
  spotPriceX18: string;
}>;

export function dammTvlQuoteRaw(row: DammStatsRow) {
  if (!row.reserve0Raw || !row.reserve1Raw) return null;
  const token0IsX = row.tokenXAddress.toLowerCase() < row.tokenYAddress.toLowerCase();
  const quoteIsX = row.quoteAddress.toLowerCase() === row.tokenXAddress.toLowerCase();
  const quoteIsToken0 = quoteIsX === token0IsX;
  const reserve0 = BigInt(row.reserve0Raw);
  const reserve1 = BigInt(row.reserve1Raw);
  const quoteReserve = quoteIsToken0 ? reserve0 : reserve1;
  const baseReserve = quoteIsToken0 ? reserve1 : reserve0;
  const baseDecimals = quoteIsX ? row.tokenYDecimals : row.tokenXDecimals;
  const baseValueQuoteRaw =
    baseReserve * BigInt(row.spotPriceX18) * 10n ** BigInt(row.quoteDecimals) /
    (10n ** 18n * 10n ** BigInt(baseDecimals));
  return quoteReserve + baseValueQuoteRaw;
}
