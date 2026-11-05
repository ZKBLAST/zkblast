import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadServerConfig } from "@zkblast/config";
import postgres from "postgres";
import {
  createPublicClient,
  getAddress,
  type Address,
  type Hex,
} from "viem";
import { z } from "zod";

import { persistStockQuoteCatalog } from "./persist-stock-quote-catalog.js";
import { reconcileStockQuoteExternalMarkets } from "./reconcile-stock-quote-markets.js";
import { createIndexerTransport } from "./rpc-transport.js";
import {
  stockQuoteDiscoveryRecord,
  assertStockQuoteSnapshotFresh,
  verifyStockQuoteAssetOnchain,
  type StockQuoteChainReader,
} from "./stock-quote-catalog.js";

const candidateSchema = z.object({
  environment: z.literal("mainnet"),
  chainId: z.literal(4663),
  observedAt: z.string().datetime(),
  issuerSource: z.string().url(),
  sourceHash: z.string().regex(/^0x[\da-f]{64}$/iu),
  asset: z.object({
    issuerAssetId: z.string().regex(/^0x[\da-f]{64}$/iu),
    symbol: z.string().min(1).max(32),
    name: z.string().min(1).max(160),
    address: z.string().regex(/^0x[\da-f]{40}$/iu),
    decimals: z.number().int().min(0).max(36),
    currentMultiplier: z.string().min(1),
    pendingMultiplier: z.string(),
    issuerStatus: z.enum([
      "ASSET_STATUS_ACTIVE",
      "ASSET_STATUS_INACTIVE",
      "ASSET_STATUS_UNSPECIFIED",
    ]),
    marketTradingStatus: z.string(),
    extendedTradingStatus: z.string(),
    overnightTradingStatus: z.string(),
  }),
});

const runtimeSchema = z.object({
  SUPABASE_DIRECT_DATABASE_URL: z.string().url(),
  STOCK_QUOTE_CATALOG_FILE: z.string().min(1).optional(),
  STOCK_QUOTE_ISSUER_NAME: z.string().min(1).max(160).default("Robinhood"),
  STOCK_QUOTE_CATALOG_MAX_AGE_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(604_800)
    .default(86_400),
});

const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const runtime = runtimeSchema.parse(process.env);
const config = loadServerConfig(process.env);
if (config.CHAIN_ID !== 4663 || config.APP_ENV !== "mainnet") {
  throw new Error("STOCK_QUOTE_MAINNET_ONLY");
}

const candidatePath = resolve(
  projectRoot,
  runtime.STOCK_QUOTE_CATALOG_FILE ??
    "deployments/mainnet/stock-quotes/canary-candidate.json",
);
const candidate = candidateSchema.parse(
  JSON.parse(await readFile(candidatePath, "utf8")),
);
assertStockQuoteSnapshotFresh(
  candidate.observedAt,
  Date.now(),
  runtime.STOCK_QUOTE_CATALOG_MAX_AGE_SECONDS,
);
const client = createPublicClient({
  cacheTime: 0,
  transport: createIndexerTransport(config.RPC_URL),
});
const reader: StockQuoteChainReader = {
  async chainId() {
    return client.getChainId();
  },
  async bytecode(address) {
    return client.getCode({ address });
  },
  async decimals(address) {
    return client.readContract({
      address,
      abi: [
        {
          type: "function",
          stateMutability: "view",
          name: "decimals",
          inputs: [],
          outputs: [{ type: "uint8" }],
        },
      ],
      functionName: "decimals",
    });
  },
};
const marketStatuses = [
  candidate.asset.marketTradingStatus,
  candidate.asset.extendedTradingStatus,
  candidate.asset.overnightTradingStatus,
];
const discovered = stockQuoteDiscoveryRecord(
  {
    id: candidate.asset.issuerAssetId as Hex,
    tokenSymbol: candidate.asset.symbol,
    tokenName: candidate.asset.name,
    tokenDecimals: candidate.asset.decimals,
    currentMultiplier: candidate.asset.currentMultiplier,
    pendingMultiplier: candidate.asset.pendingMultiplier,
    status: candidate.asset.issuerStatus,
    deployment: {
      chainId: candidate.chainId,
      contractAddress: getAddress(candidate.asset.address) as Address,
    },
  },
  {
    isTradingHalt: marketStatuses.some((status) =>
      /HALT|SUSPEND|UNAVAILABLE/iu.test(status),
    ),
    generatedAt: candidate.observedAt,
  },
  runtime.STOCK_QUOTE_ISSUER_NAME,
);
const verified = await verifyStockQuoteAssetOnchain(reader, discovered);
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
      [verified],
    );
    await persistStockQuoteCatalog(
      transaction,
      config.SUPABASE_SCHEMA,
      {
        chainId: candidate.chainId,
        sourceHash: candidate.sourceHash,
        issuerName: runtime.STOCK_QUOTE_ISSUER_NAME,
        sourceObservedAt: candidate.observedAt,
      },
      [verified],
    );
  });
  console.log(
    JSON.stringify(
      {
        chainId: candidate.chainId,
        schema: config.SUPABASE_SCHEMA,
        source: candidate.issuerSource,
        sourceHash: candidate.sourceHash,
        assets: 1,
        symbol: verified.symbol,
        address: getAddress(verified.contractAddress),
        availability: verified.availability,
        quoteTradingEnabled: false,
        graduationEnabled: false,
      },
      null,
      2,
    ),
  );
} finally {
  await sql.end({ timeout: 5 });
}
