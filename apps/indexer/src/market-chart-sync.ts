import postgres from "postgres";
import { createPublicClient, http, type Address } from "viem";
import { z } from "zod";
import { syncPoolChartSwaps } from "./sync-pool-chart-swaps.js";
import { syncReferenceChartPrices } from "./sync-reference-chart-prices.js";

const settingsSchema = z.object({
  SUPABASE_DIRECT_DATABASE_URL: z.string().url(),
  CHART_SYNC_INTERVAL_MS: z.coerce.number().int().min(60000).default(300000),
  CHART_SYNC_MAX_BLOCKS: z.coerce
    .bigint()
    .min(1n)
    .max(1000000n)
    .default(100000n),
  PONS_RPC_URL: z
    .string()
    .url()
    .default("https://rpc.mainnet.chain.robinhood.com"),
  STOCK_TOKEN_API_URL: z
    .string()
    .url()
    .default("https://api.robinhood.com/rhj"),
  CHAINLINK_FEED_REGISTRY_URL: z
    .string()
    .url()
    .default(
      "https://docs.chain.link/data-feeds/price-feeds/addresses?network=robinhood",
    ),
});
type Network = {
  APP_ENV: "mainnet" | "testnet";
  CHAIN_ID: number;
  RPC_URL: string;
  SUPABASE_SCHEMA: string;
};
export function marketChartSynchronizer(network: Network, registry: Address) {
  if (
    network.SUPABASE_SCHEMA !== `zkblast_${network.APP_ENV}` ||
    network.CHAIN_ID !== (network.APP_ENV === "mainnet" ? 4663 : 46630)
  )
    throw new Error("CHART_NETWORK_SCHEMA_MISMATCH");
  const settings = settingsSchema.parse(process.env);
  const sql = postgres(settings.SUPABASE_DIRECT_DATABASE_URL, {
    max: 1,
    prepare: false,
    idle_timeout: 10,
  });
  const execution = createPublicClient({
    transport: http(network.RPC_URL, { timeout: 20000, retryCount: 1 }),
  });
  const reference = createPublicClient({
    transport: http(
      network.APP_ENV === "mainnet" ? network.RPC_URL : settings.PONS_RPC_URL,
      { timeout: 20000, retryCount: 1 },
    ),
  });
  let running = false;
  const synchronize = async () => {
    if (running) return null;
    running = true;
    try {
      const pools = await syncPoolChartSwaps({
        client: execution,
        sql,
        schema: network.SUPABASE_SCHEMA,
        chainId: network.CHAIN_ID,
        registry,
        maximumBlocks: settings.CHART_SYNC_MAX_BLOCKS,
      }).catch(() => ({ unavailable: true }));
      const markets = await syncReferenceChartPrices({
        client: reference,
        sql,
        schema: network.SUPABASE_SCHEMA,
        stockApi: settings.STOCK_TOKEN_API_URL.replace(/\/$/u, ""),
        feedRegistry: settings.CHAINLINK_FEED_REGISTRY_URL,
      }).catch(() => ({ unavailable: true }));
      const result = {
        service: "chart-sync",
        environment: network.APP_ENV,
        pools,
        markets,
      };
      console.log(JSON.stringify(result));
      return result;
    } finally {
      running = false;
    }
  };
  return {
    synchronize,
    intervalMs: settings.CHART_SYNC_INTERVAL_MS,
    close: () => sql.end(),
  };
}
