import postgres from "postgres";
import { getChainDescriptor } from "@zkblast/config";
import { createPublicClient, type Address } from "viem";
import { z } from "zod";
import { syncPoolChartSwaps } from "./sync-pool-chart-swaps.js";
import { reconcilePoolState } from "./reconcile-pool-state.js";
import { syncReferenceChartPrices } from "./sync-reference-chart-prices.js";
import {
  createIndexerTransport,
  resolveHistoricalRpcFallbackUrls,
  resolveRpcFallbackUrls,
} from "./rpc-transport.js";

const settingsSchema = z.object({
  SUPABASE_DIRECT_DATABASE_URL: z.string().url(),
  CHART_SYNC_INTERVAL_MS: z.coerce.number().int().min(60000).default(60000),
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
  const descriptor = getChainDescriptor(network.CHAIN_ID);
  if (
    network.APP_ENV !== descriptor.environment ||
    network.SUPABASE_SCHEMA !== descriptor.databaseSchema
  )
    throw new Error("CHART_NETWORK_SCHEMA_MISMATCH");
  const settings = settingsSchema.parse(process.env);
  const sql = postgres(settings.SUPABASE_DIRECT_DATABASE_URL, {
    max: 1,
    prepare: false,
    idle_timeout: 10,
  });
  const executionFallbacks = resolveHistoricalRpcFallbackUrls(
    network.CHAIN_ID,
    resolveRpcFallbackUrls(
      process.env.RPC_FALLBACK_URLS,
      descriptor.publicRpcUrls,
    ),
  );
  const execution = createPublicClient({
    transport: createIndexerTransport(network.RPC_URL, executionFallbacks),
  });
  const reference =
    descriptor.family === "robinhood"
      ? network.APP_ENV === "mainnet"
        ? execution
        : createPublicClient({
            transport: createIndexerTransport(
              settings.PONS_RPC_URL,
              resolveHistoricalRpcFallbackUrls(
                4_663,
                getChainDescriptor(4_663).publicRpcUrls,
              ),
            ),
          })
      : null;
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
      const poolState = await reconcilePoolState({
        client: execution,
        sql,
        schema: network.SUPABASE_SCHEMA,
        chainId: network.CHAIN_ID,
      }).catch(() => ({ unavailable: true }));
      const markets = reference
        ? await syncReferenceChartPrices({
            client: reference,
            sql,
            schema: network.SUPABASE_SCHEMA,
            stockApi: settings.STOCK_TOKEN_API_URL.replace(/\/$/u, ""),
            feedRegistry: settings.CHAINLINK_FEED_REGISTRY_URL,
          }).catch(() => ({ unavailable: true }))
        : { disabled: true, reason: "CHAIN_FAMILY_NOT_SUPPORTED" };
      const result = {
        service: "chart-sync",
        environment: network.APP_ENV,
        pools,
        poolState,
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
