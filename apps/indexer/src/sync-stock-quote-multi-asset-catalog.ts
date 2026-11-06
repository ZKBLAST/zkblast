import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadServerConfig } from "@zkblast/config";
import { loadDeploymentManifestFile } from "@zkblast/config/node";
import type { StockQuoteCatalogRecord } from "@zkblast/database";
import postgres from "postgres";
import { createPublicClient, getAddress, parseAbi } from "viem";
import { z } from "zod";

import { persistStockQuoteCatalog } from "./persist-stock-quote-catalog.js";
import { reconcileStockQuoteExternalMarkets } from "./reconcile-stock-quote-markets.js";
import { createIndexerTransport } from "./rpc-transport.js";

const planSchema = z.object({
  environment: z.literal("mainnet"),
  chainId: z.literal(4663),
  planSha256: z.string().regex(/^[\da-f]{64}$/u),
  observations: z.array(
    z.object({
      symbol: z.string().min(1).max(32),
      address: z.string().regex(/^0x[\da-f]{40}$/iu),
      issuerAssetId: z.string().regex(/^0x[\da-f]{64}$/iu),
      multiplierX18: z.string().regex(/^\d+$/u),
      decimals: z.number().int().min(0).max(36),
      feed: z.string().regex(/^0x[\da-f]{40}$/iu),
      maximumAge: z.number().int().positive(),
      activationStatus: z.enum(["planned", "blocked_stale_oracle"]),
    }),
  ),
});

const runtime = z
  .object({
    SUPABASE_DIRECT_DATABASE_URL: z.string().url(),
    STOCK_QUOTE_MULTI_ASSET_PLAN_FILE: z.string().min(1).optional(),
  })
  .parse(process.env);
const config = loadServerConfig(process.env);
if (config.APP_ENV !== "mainnet" || config.CHAIN_ID !== 4663) {
  throw new Error("STOCK_QUOTE_MAINNET_ONLY");
}

const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const planPath = resolve(
  projectRoot,
  runtime.STOCK_QUOTE_MULTI_ASSET_PLAN_FILE ??
    "deployments/mainnet/stock-quotes/multi-asset-activation-plan.json",
);
const plan = planSchema.parse(JSON.parse(await readFile(planPath, "utf8")));
const active = plan.observations.filter(
  (asset) => asset.activationStatus !== "blocked_stale_oracle",
);
if (active.length !== 5)
  throw new Error("STOCK_QUOTE_ACTIVE_ASSET_SET_MISMATCH");

const manifest = await loadDeploymentManifestFile(
  resolve(projectRoot, config.DEPLOYMENT_MANIFEST_PATH),
  { environment: config.APP_ENV, chainId: config.CHAIN_ID },
);
if (!manifest.stockQuoteAssets)
  throw new Error("STOCK_QUOTE_ASSETS_NOT_DEPLOYED");

const registry = getAddress(manifest.stockQuoteAssets.assetRegistry);
const client = createPublicClient({
  cacheTime: 0,
  transport: createIndexerTransport(config.RPC_URL),
});
const registryAbi = parseAbi([
  "function quoteAssetConfig(address) view returns ((bool enabled,bool quoteTradingEnabled,bool graduationEnabled,address priceFeed,uint8 tokenDecimals,uint32 maxOracleAge,uint16 maxOracleDeviationBps,uint128 maxLaunchQuoteExposure,uint128 maxPoolQuoteExposure,bytes32 issuerAssetId))",
]);
const tokenAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function uid() view returns (bytes32)",
]);
const names: Readonly<Record<string, string>> = {
  AMD: "AMD • Robinhood Token",
  AMZN: "Amazon • Robinhood Token",
  META: "Meta Platforms • Robinhood Token",
  PLTR: "Palantir Technologies • Robinhood Token",
  TSLA: "Tesla • Robinhood Token",
};
const latestBlock = await client.getBlock({ blockTag: "latest" });
const observedAt = new Date(
  Number(latestBlock.timestamp) * 1_000,
).toISOString();
const records: StockQuoteCatalogRecord[] = [];

for (const asset of active) {
  const address = getAddress(asset.address);
  const [policy, decimals, issuerAssetId] = await Promise.all([
    client.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "quoteAssetConfig",
      args: [address],
    }),
    client.readContract({ address, abi: tokenAbi, functionName: "decimals" }),
    client.readContract({ address, abi: tokenAbi, functionName: "uid" }),
  ]);
  if (
    !policy.enabled ||
    !policy.quoteTradingEnabled ||
    policy.graduationEnabled ||
    getAddress(policy.priceFeed) !== getAddress(asset.feed) ||
    Number(policy.tokenDecimals) !== asset.decimals ||
    Number(policy.maxOracleAge) !== asset.maximumAge ||
    Number(decimals) !== asset.decimals ||
    issuerAssetId.toLowerCase() !== asset.issuerAssetId.toLowerCase() ||
    policy.issuerAssetId.toLowerCase() !== asset.issuerAssetId.toLowerCase()
  ) {
    throw new Error(`STOCK_QUOTE_ONCHAIN_POLICY_MISMATCH:${asset.symbol}`);
  }
  const instrumentName = names[asset.symbol];
  if (!instrumentName)
    throw new Error(`STOCK_QUOTE_NAME_MISSING:${asset.symbol}`);
  records.push({
    chainId: 4663,
    issuerAssetId: asset.issuerAssetId,
    contractAddress: address,
    symbol: asset.symbol,
    instrumentName,
    issuerName: "Robinhood",
    tokenDecimals: asset.decimals,
    currentMultiplier: asset.multiplierX18,
    pendingMultiplier: "",
    availability: "listed",
    marketState: "active",
    quoteTradingEnabled: true,
    graduationEnabled: false,
    priceFeedAddress: getAddress(asset.feed),
    maxOracleAgeSeconds: asset.maximumAge,
    observedAt,
    sourceHash: `0x${plan.planSha256}`,
  });
}

const sql = postgres(runtime.SUPABASE_DIRECT_DATABASE_URL, {
  max: 1,
  prepare: false,
  idle_timeout: 10,
});
try {
  await sql.begin(async (transaction) => {
    await reconcileStockQuoteExternalMarkets(
      transaction,
      config.SUPABASE_SCHEMA,
      records,
    );
    await persistStockQuoteCatalog(
      transaction,
      config.SUPABASE_SCHEMA,
      {
        chainId: 4663,
        sourceHash: `0x${plan.planSha256}`,
        issuerName: "Robinhood",
        sourceObservedAt: observedAt,
      },
      records,
    );
    for (const record of records) {
      if (!record.priceFeedAddress || !record.maxOracleAgeSeconds) {
        throw new Error(`STOCK_QUOTE_ORACLE_POLICY_MISSING:${record.symbol}`);
      }
      await transaction.unsafe(
        `update ${config.SUPABASE_SCHEMA}.stock_quote_assets
         set availability='listed',market_state='active',quote_trading_enabled=true,
             graduation_enabled=false,price_feed_address=$3,max_oracle_age_seconds=$4,
             token_decimals=$5,updated_at=now()
         where chain_id=$1 and lower(contract_address)=lower($2)`,
        [
          record.chainId,
          record.contractAddress,
          record.priceFeedAddress.toLowerCase(),
          record.maxOracleAgeSeconds,
          record.tokenDecimals,
        ],
      );
    }
  });
  console.log(
    JSON.stringify(
      {
        environment: config.APP_ENV,
        chainId: config.CHAIN_ID,
        schema: config.SUPABASE_SCHEMA,
        registry,
        sourceHash: `0x${plan.planSha256}`,
        observedAt,
        assets: records.map((record) => ({
          symbol: record.symbol,
          address: getAddress(record.contractAddress),
          quoteTradingEnabled: true,
          graduationEnabled: false,
        })),
      },
      null,
      2,
    ),
  );
} finally {
  await sql.end({ timeout: 5 });
}
