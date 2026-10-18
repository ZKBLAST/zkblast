import postgres from "postgres";
import { getAddress } from "viem";
import { z } from "zod";

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/u)
  .transform((value) => getAddress(value).toLowerCase());
const config = z
  .object({
    SUPABASE_DIRECT_DATABASE_URL: z.string().url(),
    SUPABASE_SCHEMA: z.enum(["zkblast_testnet", "zkblast_mainnet"]),
    CHAIN_ID: z.coerce
      .number()
      .int()
      .refine((value) => [4663, 46630].includes(value)),
    EXECUTION_WETH_ADDRESS: address,
    EXECUTION_USDG_ADDRESS: address,
  })
  .parse(process.env);

const sql = postgres(config.SUPABASE_DIRECT_DATABASE_URL, {
  max: 1,
  prepare: true,
});
type Market = Readonly<{
  id: string;
  source: "pons_graduated" | "robinhood_stock_token";
  metadata: Record<string, unknown>;
}>;

const expectedChainId =
  config.SUPABASE_SCHEMA === "zkblast_testnet" ? 46630 : 4663;
if (config.CHAIN_ID !== expectedChainId)
  throw new Error(
    `Schema ${config.SUPABASE_SCHEMA} cannot use execution chain ${config.CHAIN_ID}`,
  );

async function upsertPair(
  marketId: string,
  input: Readonly<{
    quoteSymbol: "USDG" | "WETH";
    quoteAddress: string;
    priority: number;
    routeStatus: "planned" | "observed";
    venue?: string;
    poolIdentifier?: string;
    metadata: Record<string, string>;
    baseAddress: string | null;
  }>,
) {
  await sql.unsafe(
    `insert into ${config.SUPABASE_SCHEMA}.external_market_pairs
      (market_id,data_chain_id,execution_chain_id,base_address,quote_symbol,quote_address,priority,route_status,venue,pool_identifier,metadata)
     values ($1,4663,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
     on conflict (market_id,priority) do update set
       execution_chain_id=excluded.execution_chain_id,
       base_address=excluded.base_address,
       quote_symbol=excluded.quote_symbol,
       quote_address=excluded.quote_address,
       priority=excluded.priority,
       route_status=case when ${config.SUPABASE_SCHEMA}.external_market_pairs.route_status='validated'
         and ${config.SUPABASE_SCHEMA}.external_market_pairs.execution_chain_id=excluded.execution_chain_id
         and ${config.SUPABASE_SCHEMA}.external_market_pairs.base_address is not distinct from excluded.base_address
         and ${config.SUPABASE_SCHEMA}.external_market_pairs.quote_address=excluded.quote_address
         then 'validated' else excluded.route_status end,
       venue=case when ${config.SUPABASE_SCHEMA}.external_market_pairs.execution_chain_id=excluded.execution_chain_id
         and ${config.SUPABASE_SCHEMA}.external_market_pairs.base_address is not distinct from excluded.base_address
         and ${config.SUPABASE_SCHEMA}.external_market_pairs.quote_address=excluded.quote_address
         then coalesce(${config.SUPABASE_SCHEMA}.external_market_pairs.venue,excluded.venue) else excluded.venue end,
       pool_identifier=case when ${config.SUPABASE_SCHEMA}.external_market_pairs.execution_chain_id=excluded.execution_chain_id
         and ${config.SUPABASE_SCHEMA}.external_market_pairs.base_address is not distinct from excluded.base_address
         and ${config.SUPABASE_SCHEMA}.external_market_pairs.quote_address=excluded.quote_address
         then coalesce(${config.SUPABASE_SCHEMA}.external_market_pairs.pool_identifier,excluded.pool_identifier) else excluded.pool_identifier end,
       validated_at=case when ${config.SUPABASE_SCHEMA}.external_market_pairs.execution_chain_id=excluded.execution_chain_id
         and ${config.SUPABASE_SCHEMA}.external_market_pairs.base_address is not distinct from excluded.base_address
         and ${config.SUPABASE_SCHEMA}.external_market_pairs.quote_address=excluded.quote_address
         then ${config.SUPABASE_SCHEMA}.external_market_pairs.validated_at else null end,
       liquidity_raw=case when ${config.SUPABASE_SCHEMA}.external_market_pairs.execution_chain_id=excluded.execution_chain_id
         and ${config.SUPABASE_SCHEMA}.external_market_pairs.base_address is not distinct from excluded.base_address
         and ${config.SUPABASE_SCHEMA}.external_market_pairs.quote_address=excluded.quote_address
         then ${config.SUPABASE_SCHEMA}.external_market_pairs.liquidity_raw else null end,
       observed_block=case when ${config.SUPABASE_SCHEMA}.external_market_pairs.execution_chain_id=excluded.execution_chain_id
         and ${config.SUPABASE_SCHEMA}.external_market_pairs.base_address is not distinct from excluded.base_address
         and ${config.SUPABASE_SCHEMA}.external_market_pairs.quote_address=excluded.quote_address
         then ${config.SUPABASE_SCHEMA}.external_market_pairs.observed_block else null end,
       observed_at=case when ${config.SUPABASE_SCHEMA}.external_market_pairs.execution_chain_id=excluded.execution_chain_id
         and ${config.SUPABASE_SCHEMA}.external_market_pairs.base_address is not distinct from excluded.base_address
         and ${config.SUPABASE_SCHEMA}.external_market_pairs.quote_address=excluded.quote_address
         then ${config.SUPABASE_SCHEMA}.external_market_pairs.observed_at else null end,
       metadata=excluded.metadata,updated_at=now()`,
    [
      marketId,
      config.CHAIN_ID,
      input.baseAddress,
      input.quoteSymbol,
      input.quoteAddress,
      input.priority,
      input.routeStatus,
      input.venue ?? null,
      input.poolIdentifier ?? null,
      sql.json(input.metadata),
    ],
  );
}

try {
  const markets = await sql.unsafe<Market[]>(
    `select id,source,metadata from ${config.SUPABASE_SCHEMA}.external_markets
     where status='active' order by source,id`,
  );
  let candidates = 0;
  for (const market of markets) {
    const executionAddress = address.safeParse(
      market.metadata.executionAddress,
    );
    if (market.source === "robinhood_stock_token") {
      await upsertPair(market.id, {
        quoteSymbol: "USDG",
        quoteAddress: config.EXECUTION_USDG_ADDRESS,
        baseAddress: executionAddress.success ? executionAddress.data : null,
        priority: 1,
        routeStatus: "planned",
        metadata: { preference: "usd-denominated-stock-token" },
      });
      await upsertPair(market.id, {
        quoteSymbol: "WETH",
        quoteAddress: config.EXECUTION_WETH_ADDRESS,
        baseAddress: executionAddress.success ? executionAddress.data : null,
        priority: 2,
        routeStatus: "planned",
        metadata: { preference: "secondary-crypto-liquidity" },
      });
      candidates += 2;
      continue;
    }
    await upsertPair(market.id, {
      quoteSymbol: "WETH",
      quoteAddress: config.EXECUTION_WETH_ADDRESS,
      baseAddress: executionAddress.success ? executionAddress.data : null,
      priority: 1,
      routeStatus: "planned",
      metadata: { preference: "testnet-weth-execution" },
    });
    candidates += 1;
  }
  console.log(JSON.stringify({ markets: markets.length, candidates }));
} finally {
  await sql.end();
}
