import postgres from "postgres";
import type { DbcCandleQuery, DbcPage, DbcReadStore } from "./dbc-service.js";

const schemaPattern = /^zkblast_(testnet|mainnet)$/u;
const intervals = { "1m": "1 minute", "5m": "5 minutes", "15m": "15 minutes", "1h": "1 hour", "1d": "1 day" } as const;

export class PostgresDbcReadStore implements DbcReadStore {
  readonly #sql;
  constructor(databaseUrl: string, private readonly schema: string) {
    if (!schemaPattern.test(schema)) throw new Error("INVALID_DATABASE_SCHEMA");
    this.#sql = postgres(databaseUrl, { max: 3, prepare: false, idle_timeout: 10 });
  }
  templates(page: DbcPage) {
    return this.#sql.unsafe(`select template_id,family_id,config_hash,version,enabled,used,updated_block from ${this.schema}.dbc_templates
      where ($2::numeric is null or template_id < $2::numeric) order by template_id desc limit $1`, [page.limit, page.cursor ?? null]);
  }
  launches(query: DbcPage & Readonly<{ search?: string | undefined; lifecycle?: number | undefined }>) {
    return this.#sql.unsafe(`select launch_id,template_id,creator,token_address,virtual_pool,quote_token,name,symbol,metadata_uri,lifecycle,
      real_quote_reserve_raw::text,base_sold_raw::text,graduation_threshold_raw::text,created_block,updated_block,
      coalesce((select sum(s.quote_amount_raw)::text from ${this.schema}.dbc_swaps s where s.launch_id=dbc_launches.launch_id and s.canonical),'0') volume_raw,
      coalesce((select count(*)::integer from ${this.schema}.dbc_swaps s where s.launch_id=dbc_launches.launch_id and s.canonical),0) trade_count,
      coalesce((select count(*)::integer from ${this.schema}.dbc_holder_balances h where h.launch_id=dbc_launches.launch_id and h.balance_raw>0),0) holder_count,
      case when graduation_threshold_raw is null then 0 else least(10000,floor(real_quote_reserve_raw*10000/graduation_threshold_raw))::integer end progress_bps
      from ${this.schema}.dbc_launches where ($1::text is null or launch_id < $1)
      and ($2::integer is null or lifecycle=$2) and ($3::text is null or name ilike '%'||$3||'%' or symbol ilike '%'||$3||'%')
      order by launch_id desc limit $4`, [query.cursor ?? null, query.lifecycle ?? null, query.search ?? null, query.limit]);
  }
  async launch(launchId: string) {
    const rows = await this.#sql.unsafe(`select * from ${this.schema}.dbc_launches where launch_id=$1 limit 1`, [launchId]);
    return rows[0] ?? null;
  }
  trades(launchId: string, page: DbcPage) {
    return this.#sql.unsafe(`select transaction_hash,log_index,is_buy,quote_amount_raw::text,base_amount_raw::text,fee_raw::text,price_x18::text,block_number,observed_at
      from ${this.schema}.dbc_swaps where launch_id=$1 and canonical and ($2::text is null or (block_number::text||':'||log_index::text)<$2)
      order by block_number desc,log_index desc limit $3`, [launchId,page.cursor ?? null,page.limit]);
  }
  candles(launchId: string, query: DbcCandleQuery) {
    const interval = intervals[query.interval];
    return this.#sql.unsafe(`select date_bin('${interval}',observed_at,timestamptz '1970-01-01') bucket,
      (array_agg(price_x18::text order by block_number,log_index))[1] open_x18,max(price_x18)::text high_x18,min(price_x18)::text low_x18,
      (array_agg(price_x18::text order by block_number desc,log_index desc))[1] close_x18,sum(base_amount_raw)::text base_volume_raw,
      sum(quote_amount_raw)::text quote_volume_raw,count(*)::integer trades from ${this.schema}.dbc_swaps
      where launch_id=$1 and canonical and observed_at >= $2 and observed_at <= $3 group by bucket order by bucket limit $4`,
      [launchId,query.from,query.to,query.limit]);
  }
  async graduation(launchId: string) {
    const rows = await this.#sql.unsafe(`select g.*,coalesce(jsonb_agg(a order by a.allocation_kind) filter(where a.migration_id is not null),'[]'::jsonb) allocations
      from ${this.schema}.dbc_graduations g left join ${this.schema}.dbc_lp_allocations a using(migration_id)
      where g.launch_id=$1 group by g.migration_id limit 1`, [launchId]);
    return rows[0] ?? null;
  }
  close() { return this.#sql.end(); }
}
