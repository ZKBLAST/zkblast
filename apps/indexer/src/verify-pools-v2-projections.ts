import { loadServerConfig } from "@zkblast/config";
import postgres from "postgres";

const config = loadServerConfig(process.env);
const databaseUrl = process.env.SUPABASE_DIRECT_DATABASE_URL;
if (!databaseUrl) throw new Error("DIRECT_DATABASE_URL_REQUIRED");
const sql = postgres(databaseUrl, {
  ssl: "require",
  max: 1,
  prepare: false,
});

try {
  await sql.begin(async (transaction) => {
    await transaction`set transaction read only`;
    const [summary] = await transaction.unsafe<{
      pools: number;
      missing_quote: number;
      missing_bin_step: number;
      canonical_swaps: number;
      missing_spot: number;
      missing_side: number;
      missing_quote_volume: number;
      stale_states: number;
      zero_liquidity_states: number;
    }[]>(
      `select
        (select count(*)::integer from ${config.SUPABASE_SCHEMA}.pools where chain_id=$1) pools,
        (select count(*)::integer from ${config.SUPABASE_SCHEMA}.pools
          where chain_id=$1 and quote_token_id is null) missing_quote,
        (select count(*)::integer from ${config.SUPABASE_SCHEMA}.pools
          where chain_id=$1 and pool_kind='dlmm' and bin_step_bps is null) missing_bin_step,
        (select count(*)::integer from ${config.SUPABASE_SCHEMA}.swaps
          where chain_id=$1 and canonical) canonical_swaps,
        (select count(*)::integer from ${config.SUPABASE_SCHEMA}.swaps
          where chain_id=$1 and canonical and spot_price_x18 is null) missing_spot,
        (select count(*)::integer from ${config.SUPABASE_SCHEMA}.swaps
          where chain_id=$1 and canonical and side is null) missing_side,
        (select count(*)::integer from ${config.SUPABASE_SCHEMA}.swaps
          where chain_id=$1 and canonical and volume_quote_raw is null) missing_quote_volume,
        (select count(*)::integer from ${config.SUPABASE_SCHEMA}.pool_state
          where chain_id=$1 and observed_at < now()-interval '15 minutes') stale_states,
        (select count(*)::integer from ${config.SUPABASE_SCHEMA}.pool_state
          where chain_id=$1 and reserve0_raw=0 and reserve1_raw=0) zero_liquidity_states`,
      [config.CHAIN_ID],
    );
    const mismatches = await transaction.unsafe(
      `select p.address,p.pool_kind,s.observed_block::text,s.observed_at
       from ${config.SUPABASE_SCHEMA}.pools p
       left join ${config.SUPABASE_SCHEMA}.pool_state s on s.pool_id=p.id
       where p.chain_id=$1 and (s.pool_id is null or
         (s.spot_price_x18 is null and s.reserve0_raw>0 and s.reserve1_raw>0))
       order by p.address limit 100`,
      [config.CHAIN_ID],
    );
    if (!summary) throw new Error("POOLS_V2_VERIFICATION_UNAVAILABLE");
    console.log(JSON.stringify({
      mode: "read-only",
      environment: config.APP_ENV,
      chainId: config.CHAIN_ID,
      schema: config.SUPABASE_SCHEMA,
      summary,
      mismatches,
      ready: summary.missing_quote === 0 &&
        summary.missing_bin_step === 0 &&
        summary.missing_spot === 0 &&
        summary.missing_side === 0 &&
        summary.missing_quote_volume === 0,
    }, null, 2));
  });
} finally {
  await sql.end();
}
