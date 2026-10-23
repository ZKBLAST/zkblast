import postgres from "postgres";
import { z } from "zod";
import type {
  PageQuery,
  PoolChartQuery,
  ProtocolReadStore,
} from "./protocol-service.js";

const schemaPattern = /^zkblast_(testnet|mainnet)$/u;

export class PostgresProtocolReadStore implements ProtocolReadStore {
  private readonly sql;
  private readonly schema: string;

  constructor(databaseUrl: string, schema: string) {
    if (!schemaPattern.test(schema)) throw new Error("INVALID_DATABASE_SCHEMA");
    this.schema = schema;
    this.sql = postgres(databaseUrl, {
      max: 1,
      prepare: false,
      idle_timeout: 10,
    });
  }

  pools(query: PageQuery) {
    return this.sql.unsafe(
      `select p.chain_id as "chainId", p.address, p.pool_kind as model, p.fee_bps as "feeBps", p.status, p.created_block as "createdBlock", x.address as "token0Address", x.symbol as "token0Symbol", x.decimals as "token0Decimals", y.address as "token1Address", y.symbol as "token1Symbol", y.decimals as "token1Decimals" from ${this.schema}.pools p join ${this.schema}.assets x on x.id=p.token_x_id join ${this.schema}.assets y on y.id=p.token_y_id where ($1::text is null or p.address > $1) order by p.address asc limit $2`,
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
        ((case when s.token_in_id=p.token_x_id then s.amount_out_raw/s.amount_in_raw
          else s.amount_in_raw/s.amount_out_raw end) * power(10::numeric,x.decimals-y.decimals))::text as price,
        ((case when s.token_in_id=p.token_y_id then s.amount_in_raw else s.amount_out_raw end)
          / power(10::numeric,y.decimals))::text as volume,
        y.symbol as "priceUnit", s.block_number::text as "blockNumber",s.transaction_hash as "transactionHash"
        from ${this.schema}.swaps s join ${this.schema}.pools p on p.id=s.pool_id
        join ${this.schema}.assets x on x.id=p.token_x_id join ${this.schema}.assets y on y.id=p.token_y_id
        where p.address=$1 and s.canonical and s.amount_in_raw>0 and s.amount_out_raw>0
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
  positions(query: PageQuery) {
    return this.sql.unsafe(
      `select p.onchain_position_id as "onchainPositionId", p.liquidity_raw::text as "liquidityRaw", p.lower_bound as "lowerBound", p.upper_bound as "upperBound", p.status, p.opened_at as "openedAt", p.updated_at as "updatedAt", pools.address as "poolAddress", pools.pool_kind as model, x.symbol as "token0Symbol", y.symbol as "token1Symbol" from ${this.schema}.positions p join ${this.schema}.user_wallets w on w.id=p.wallet_id join ${this.schema}.pools pools on pools.id=p.pool_id join ${this.schema}.assets x on x.id=pools.token_x_id join ${this.schema}.assets y on y.id=pools.token_y_id where ($1::text is null or p.onchain_position_id > $1) and ($2::text is null or w.wallet_address=$2) order by p.onchain_position_id asc limit $3`,
      [query.cursor ?? null, query.owner ?? null, query.limit],
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
