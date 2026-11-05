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
  const [snapshots, assets, policyEvents, destinations, externalMarkets] = await Promise.all([
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
  ]);
  const unsafeAsset = assets.find(
    (asset) => asset.quote_trading_enabled || asset.graduation_enabled,
  );
  if (unsafeAsset) throw new Error("UNEXPECTED_STOCK_QUOTE_CAPABILITY_ENABLED");
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
        failClosed: true,
      },
      null,
      2,
    ),
  );
} finally {
  await sql.end({ timeout: 5 });
}
