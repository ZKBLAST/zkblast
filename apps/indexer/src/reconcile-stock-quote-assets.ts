import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadServerConfig } from "@zkblast/config";
import { loadDeploymentManifestFile } from "@zkblast/config/node";
import postgres from "postgres";
import { createPublicClient, getAddress, parseAbi } from "viem";
import { z } from "zod";

import { createIndexerTransport } from "./rpc-transport.js";

const runtime = z
  .object({ SUPABASE_DIRECT_DATABASE_URL: z.string().url() })
  .parse(process.env);
const config = loadServerConfig(process.env);
if (config.APP_ENV !== "mainnet" || config.CHAIN_ID !== 4663) {
  throw new Error("STOCK_QUOTE_MAINNET_ONLY");
}
const root = fileURLToPath(new URL("../../../", import.meta.url));
const manifest = await loadDeploymentManifestFile(
  resolve(root, config.DEPLOYMENT_MANIFEST_PATH),
  { environment: config.APP_ENV, chainId: config.CHAIN_ID },
);
if (!manifest.stockQuoteAssets) throw new Error("STOCK_QUOTE_ASSETS_NOT_DEPLOYED");

const registry = getAddress(manifest.stockQuoteAssets.assetRegistry);
const registryAbi = parseAbi([
  "function quoteAssetConfig(address) view returns ((bool enabled,bool quoteTradingEnabled,bool graduationEnabled,address priceFeed,uint8 tokenDecimals,uint32 maxOracleAge,uint16 maxOracleDeviationBps,uint128 maxLaunchQuoteExposure,uint128 maxPoolQuoteExposure,bytes32 issuerAssetId))",
]);
const client = createPublicClient({
  cacheTime: 0,
  transport: createIndexerTransport(config.RPC_URL),
});
const sql = postgres(runtime.SUPABASE_DIRECT_DATABASE_URL, {
  max: 1,
  prepare: false,
  idle_timeout: 10,
});

try {
  const assets = await sql.unsafe<{ contract_address: string }[]>(
    `select contract_address from ${config.SUPABASE_SCHEMA}.stock_quote_assets
     where chain_id=$1 order by contract_address`,
    [config.CHAIN_ID],
  );
  const reconciled: Array<Record<string, unknown>> = [];
  await sql.begin(async (transaction) => {
    for (const row of assets) {
      const asset = getAddress(row.contract_address);
      const result = (await client.readContract({
        address: registry,
        abi: registryAbi,
        functionName: "quoteAssetConfig",
        args: [asset],
      })) as {
        enabled: boolean;
        quoteTradingEnabled: boolean;
        graduationEnabled: boolean;
        priceFeed: string;
        tokenDecimals: number;
        maxOracleAge: number;
      };
      const {
        enabled,
        quoteTradingEnabled,
        graduationEnabled,
        priceFeed,
        tokenDecimals,
        maxOracleAge,
      } = result;
      await transaction.unsafe(
        `update ${config.SUPABASE_SCHEMA}.stock_quote_assets
         set availability=$3,quote_trading_enabled=$4,graduation_enabled=$5,
             price_feed_address=$6,max_oracle_age_seconds=$7,token_decimals=$8,updated_at=now()
         where chain_id=$1 and contract_address=$2`,
        [
          config.CHAIN_ID,
          asset.toLowerCase(),
          enabled ? "listed" : "disabled",
          enabled && quoteTradingEnabled,
          enabled && graduationEnabled,
          getAddress(priceFeed).toLowerCase(),
          maxOracleAge,
          tokenDecimals,
        ],
      );
      reconciled.push({
        asset,
        enabled,
        quoteTradingEnabled,
        graduationEnabled,
        priceFeed: getAddress(priceFeed),
        maxOracleAge,
      });
    }
  });
  console.log(
    JSON.stringify({
      environment: config.APP_ENV,
      chainId: config.CHAIN_ID,
      schema: config.SUPABASE_SCHEMA,
      registry,
      reconciled,
    }),
  );
} finally {
  await sql.end({ timeout: 5 });
}
