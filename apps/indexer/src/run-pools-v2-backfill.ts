import { dlmmPoolAbi } from "@zkblast/abi";
import { loadServerConfig } from "@zkblast/config";
import postgres from "postgres";
import { createPublicClient, getAddress, http } from "viem";

import { rebuildPoolProjections } from "./persist-pool-swap.js";

const config = loadServerConfig(process.env);
const databaseUrl = process.env.SUPABASE_DIRECT_DATABASE_URL;
if (!databaseUrl) throw new Error("DIRECT_DATABASE_URL_REQUIRED");
const apply = process.argv.includes("--apply");
const confirmation = process.env.POOLS_V2_BACKFILL_CONFIRM;
if (
  apply &&
  config.APP_ENV === "mainnet" &&
  confirmation !== `BACKFILL_POOLS_V2_${config.CHAIN_ID}`
) throw new Error("POOLS_V2_MAINNET_BACKFILL_CONFIRMATION_REQUIRED");

const sql = postgres(databaseUrl, {
  ssl: "require",
  max: 1,
  prepare: false,
});
const client = createPublicClient({
  transport: http(config.RPC_URL, { timeout: 20_000, retryCount: 1 }),
});

try {
  if ((await client.getChainId()) !== config.CHAIN_ID)
    throw new Error("POOLS_V2_BACKFILL_CHAIN_MISMATCH");
  const pools = await sql.unsafe<{
    id: string;
    address: string;
    pool_kind: "damm" | "dlmm";
    quote_token_id: string | null;
    bin_step_bps: number | null;
  }[]>(
    `select id,address,pool_kind,quote_token_id,bin_step_bps
     from ${config.SUPABASE_SCHEMA}.pools where chain_id=$1 order by address`,
    [config.CHAIN_ID],
  );
  const plan: Array<{
    id: string;
    address: string;
    model: "damm" | "dlmm";
    quoteTokenId: string;
    binStepBps: number | null;
    quoteUpdate: boolean;
    binStepUpdate: boolean;
  }> = [];
  for (const pool of pools) {
    const pair = await sql.unsafe<{ quote_id: string }[]>(
      `select a.id as quote_id
       from ${config.SUPABASE_SCHEMA}.external_market_pairs p
       join ${config.SUPABASE_SCHEMA}.assets a
         on a.chain_id=p.execution_chain_id and a.address=lower(p.quote_address)
       where p.execution_chain_id=$1 and lower(p.pool_identifier)=$2
         and p.route_status='validated' order by p.priority limit 1`,
      [config.CHAIN_ID, pool.address.toLowerCase()],
    );
    const fallback = await sql.unsafe<{ token_y_id: string }[]>(
      `select token_y_id from ${config.SUPABASE_SCHEMA}.pools where id=$1`,
      [pool.id],
    );
    const quoteTokenId = pair[0]?.quote_id ?? fallback[0]?.token_y_id;
    if (!quoteTokenId) throw new Error("POOL_QUOTE_ORIENTATION_UNRESOLVED");
    const binStepBps = pool.pool_kind === "dlmm"
      ? Number(await client.readContract({
          address: getAddress(pool.address),
          abi: dlmmPoolAbi,
          functionName: "binStepBps",
        }))
      : null;
    plan.push({
      id: pool.id,
      address: pool.address,
      model: pool.pool_kind,
      quoteTokenId,
      binStepBps,
      quoteUpdate: pool.quote_token_id !== quoteTokenId,
      binStepUpdate: pool.bin_step_bps !== binStepBps,
    });
  }
  const before = await projectionCounts(sql, config.SUPABASE_SCHEMA);
  if (apply) {
    await sql.begin(async (transaction) => {
      for (const pool of plan)
        await transaction.unsafe(
          `update ${config.SUPABASE_SCHEMA}.pools
           set quote_token_id=$2,bin_step_bps=$3 where id=$1 and chain_id=$4`,
          [pool.id, pool.quoteTokenId, pool.binStepBps, config.CHAIN_ID],
        );
      await transaction.unsafe(
        `update ${config.SUPABASE_SCHEMA}.swaps set
          side=null,trader=null,recipient=null,active_bin=null,
          reserve0_after_raw=null,reserve1_after_raw=null,
          spot_price_x18=null,volume_quote_raw=null
         where chain_id=$1`,
        [config.CHAIN_ID],
      );
      await rebuildPoolProjections(
        transaction,
        config.SUPABASE_SCHEMA,
        config.CHAIN_ID,
      );
    });
  }
  const after = apply
    ? await projectionCounts(sql, config.SUPABASE_SCHEMA)
    : before;
  console.log(JSON.stringify({
    mode: apply ? "applied" : "dry-run",
    environment: config.APP_ENV,
    chainId: config.CHAIN_ID,
    schema: config.SUPABASE_SCHEMA,
    pools: plan.length,
    quoteUpdates: plan.filter((pool) => pool.quoteUpdate).length,
    binStepUpdates: plan.filter((pool) => pool.binStepUpdate).length,
    before,
    after,
  }, null, 2));
} finally {
  await sql.end();
}

async function projectionCounts(connection: postgres.Sql, schema: string) {
  const [row] = await connection.unsafe<{
    swaps: number;
    corrected: number;
    candles: number;
    states: number;
  }[]>(
    `select
      (select count(*)::integer from ${schema}.swaps where canonical) swaps,
      (select count(*)::integer from ${schema}.swaps
        where canonical and side is not null and spot_price_x18 is not null
          and volume_quote_raw is not null) corrected,
      (select count(*)::integer from ${schema}.pool_candles) candles,
      (select count(*)::integer from ${schema}.pool_state) states`,
  );
  return row;
}
