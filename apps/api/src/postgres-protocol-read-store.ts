import postgres from "postgres";
import type { PageQuery, ProtocolReadStore } from "./protocol-service.js";

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
  positions(query: PageQuery) {
    return this.sql.unsafe(
      `select p.onchain_position_id as "onchainPositionId", p.liquidity_raw::text as "liquidityRaw", p.lower_bound as "lowerBound", p.upper_bound as "upperBound", p.status, p.opened_at as "openedAt", p.updated_at as "updatedAt", pools.address as "poolAddress", pools.pool_kind as model, x.symbol as "token0Symbol", y.symbol as "token1Symbol" from ${this.schema}.positions p join ${this.schema}.user_wallets w on w.id=p.wallet_id join ${this.schema}.pools pools on pools.id=p.pool_id join ${this.schema}.assets x on x.id=pools.token_x_id join ${this.schema}.assets y on y.id=pools.token_y_id where ($1::text is null or p.onchain_position_id > $1) and ($2::text is null or w.wallet_address=$2) order by p.onchain_position_id asc limit $3`,
      [query.cursor ?? null, query.owner ?? null, query.limit],
    );
  }

  async indexerStatus() {
    const rows = await this.sql.unsafe(
      `select last_processed_block, finalized_block, updated_at from ${this.schema}.ingestion_checkpoints order by updated_at desc limit 1`,
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
