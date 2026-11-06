import { loadServerConfig } from "@zkblast/config";
import postgres from "postgres";
import { z } from "zod";

const runtime = z
  .object({ SUPABASE_DIRECT_DATABASE_URL: z.string().url() })
  .parse(process.env);
const config = loadServerConfig(process.env);
if (config.CHAIN_ID !== 4663 || config.APP_ENV !== "mainnet") {
  throw new Error("STOCK_QUOTE_MAINNET_ONLY");
}
const sql = postgres(runtime.SUPABASE_DIRECT_DATABASE_URL, {
  max: 1,
  prepare: false,
  idle_timeout: 10,
});
try {
  const [
    snapshots,
    assets,
    policyEvents,
    destinations,
    reserveProjectionDivergence,
    externalMarkets,
    oraclePolicyDivergence,
    destinationDivergence,
    receiptSnapshotCoverage,
  ] = await Promise.all([
    sql.unsafe<{ count: string }[]>(
      `select count(*)::text as count from ${config.SUPABASE_SCHEMA}.stock_quote_catalog_snapshots where chain_id=$1`,
      [config.CHAIN_ID],
    ),
    sql.unsafe<
      {
        symbol: string;
        contract_address: string;
        availability: string;
        market_state: string;
        quote_trading_enabled: boolean;
        graduation_enabled: boolean;
      }[]
    >(
      `select symbol,contract_address,availability,market_state,quote_trading_enabled,graduation_enabled
       from ${config.SUPABASE_SCHEMA}.stock_quote_assets where chain_id=$1 order by symbol`,
      [config.CHAIN_ID],
    ),
    sql.unsafe<{ event_kind: string; count: string }[]>(
      `select event_kind,count(*)::text as count
       from ${config.SUPABASE_SCHEMA}.stock_quote_policy_events
       where chain_id=$1 and canonical group by event_kind order by event_kind`,
      [config.CHAIN_ID],
    ),
    sql.unsafe<{ migration_mode: string; enabled: boolean; count: string }[]>(
      `select migration_mode,enabled,count(*)::text as count
       from ${config.SUPABASE_SCHEMA}.stock_quote_destination_capabilities
       where chain_id=$1 group by migration_mode,enabled order by migration_mode,enabled`,
      [config.CHAIN_ID],
    ),
    sql.unsafe<
      {
        launch_id: string;
        quote_asset_address: string;
        indexed_reserve_raw: string;
        event_reserve_raw: string;
        issue: string;
      }[]
    >(
      `select l.launch_id,l.quote_token as quote_asset_address,
         l.real_quote_reserve_raw::text as indexed_reserve_raw,
         latest.payload->>'realQuoteReserveRaw' as event_reserve_raw,
         'RESERVE_PROJECTION_DIVERGENCE' as issue
       from ${config.SUPABASE_SCHEMA}.dbc_launches l
       join ${config.SUPABASE_SCHEMA}.stock_quote_launch_policy_bindings b
         on b.chain_id=$1 and b.launch_id=l.launch_id and b.canonical
       join lateral (
         select e.payload from ${config.SUPABASE_SCHEMA}.dbc_events e
         where e.chain_id=$1 and e.launch_id=l.launch_id and e.canonical
           and e.event_name='CurveSwapExecuted'
         order by e.block_number desc,e.log_index desc limit 1
       ) latest on true
       where l.real_quote_reserve_raw <> (latest.payload->>'realQuoteReserveRaw')::numeric
       order by l.launch_id`,
      [config.CHAIN_ID],
    ),
    sql.unsafe<
      {
        external_id: string;
        contract_address: string;
        symbol: string;
        status: string;
      }[]
    >(
      `select external_id,contract_address,symbol,status
       from ${config.SUPABASE_SCHEMA}.external_markets
       where source='robinhood_stock_token'
         and lower(contract_address) in (
           select lower(contract_address) from ${config.SUPABASE_SCHEMA}.stock_quote_assets
           where chain_id=$1
         )
       order by symbol`,
      [config.CHAIN_ID],
    ),
    sql.unsafe<
      {
        symbol: string;
        contract_address: string;
        issue: string;
      }[]
    >(
      `select symbol,contract_address,'ENABLED_WITHOUT_ORACLE_POLICY' as issue
       from ${config.SUPABASE_SCHEMA}.stock_quote_assets
       where chain_id=$1 and (quote_trading_enabled or graduation_enabled)
         and (availability <> 'listed' or price_feed_address is null
           or max_oracle_age_seconds is null or max_oracle_age_seconds <= 0)
       order by symbol`,
      [config.CHAIN_ID],
    ),
    sql.unsafe<
      {
        symbol: string;
        contract_address: string;
        migration_mode: string;
        issue: string;
      }[]
    >(
      `select a.symbol,a.contract_address,d.migration_mode,
         'DESTINATION_ENABLED_WITHOUT_ASSET_POLICY' as issue
       from ${config.SUPABASE_SCHEMA}.stock_quote_destination_capabilities d
       join ${config.SUPABASE_SCHEMA}.stock_quote_assets a
         on a.chain_id=d.chain_id and a.contract_address=d.quote_asset_address
       where d.chain_id=$1 and d.enabled
         and (a.availability <> 'listed' or not a.graduation_enabled)
       order by a.symbol,d.migration_mode`,
      [config.CHAIN_ID],
    ),
    sql.unsafe<
      {
        total: string;
        missing_decimals: string;
        missing_multiplier: string;
        validated_usd_observations: string;
      }[]
    >(
      `select count(*)::text as total,
         count(*) filter(where quote_token_decimals is null)::text as missing_decimals,
         count(*) filter(where multiplier_x18 is null)::text as missing_multiplier,
         count(*) filter(where usd_notional_x18 is not null)::text as validated_usd_observations
       from ${config.SUPABASE_SCHEMA}.stock_quote_execution_receipts
       where chain_id=$1 and canonical`,
      [config.CHAIN_ID],
    ),
  ]);
  const unsafeAsset = assets.find((asset) => asset.graduation_enabled);
  if (unsafeAsset) throw new Error("UNEXPECTED_STOCK_QUOTE_GRADUATION_ENABLED");
  if (oraclePolicyDivergence.length > 0) {
    throw new Error("STOCK_QUOTE_ORACLE_POLICY_DIVERGENCE");
  }
  if (destinationDivergence.length > 0) {
    throw new Error("STOCK_QUOTE_DESTINATION_POLICY_DIVERGENCE");
  }
  if (reserveProjectionDivergence.length > 0) {
    throw new Error("STOCK_QUOTE_RESERVE_PROJECTION_DIVERGENCE");
  }
  const coverage = receiptSnapshotCoverage[0] ?? {
    total: "0",
    missing_decimals: "0",
    missing_multiplier: "0",
    validated_usd_observations: "0",
  };
  console.log(
    JSON.stringify(
      {
        environment: config.APP_ENV,
        chainId: config.CHAIN_ID,
        schema: config.SUPABASE_SCHEMA,
        snapshotCount: Number(snapshots[0]?.count ?? 0),
        assets,
        policyEvents,
        destinations,
        externalMarkets,
        oraclePolicyDivergence,
        destinationDivergence,
        reserveProjectionDivergence,
        receiptSnapshotCoverage: {
          total: Number(coverage.total),
          missingDecimals: Number(coverage.missing_decimals),
          missingMultiplier: Number(coverage.missing_multiplier),
          validatedUsdObservations: Number(coverage.validated_usd_observations),
        },
        failClosed: true,
      },
      null,
      2,
    ),
  );
} finally {
  await sql.end({ timeout: 5 });
}
