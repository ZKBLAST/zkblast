import { poolRegistryAbi } from "@zkblast/abi";
import { loadServerConfig } from "@zkblast/config";
import { loadDeploymentManifestFile } from "@zkblast/config/node";
import { resolveProtocolAddresses } from "@zkblast/sdk";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, getAddress, http } from "viem";
import { z } from "zod";
import { createApp } from "./app.js";
import { AuthService } from "./auth-service.js";
import { IdentityService } from "./identity-service.js";
import { PostgresAuthStore } from "./postgres-auth-store.js";
import { PostgresProtocolReadStore } from "./postgres-protocol-read-store.js";
import { ProtocolService } from "./protocol-service.js";
import { SwapService } from "./swap-service.js";
import { LiquidityService } from "./liquidity-service.js";
import { OperationsService } from "./operations-service.js";
import { ShieldedService } from "./shielded-service.js";
import { ExternalMarketService } from "./external-market-service.js";
import { TradeReceiptService } from "./trade-receipt-service.js";

const serviceSchema = z.object({
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  WEB_ORIGIN: z.string().url(),
  ALERT_RPC_LAG_BLOCKS: z.coerce.number().int().positive().default(25),
  ALERT_CHECKPOINT_AGE_SECONDS: z.coerce.number().int().positive().default(120),
  ALERT_TRANSACTION_FAILURES: z.coerce.number().int().positive().default(3),
  ALERT_EXTERNAL_ROUTE_AGE_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(86_400),
  ALERT_RECEIPT_FAILURES: z.coerce.number().int().positive().default(5),
});

const serverConfig = loadServerConfig(process.env);
const serviceConfig = serviceSchema.parse({
  ...process.env,
  API_PORT: process.env.PORT ?? process.env.API_PORT,
});
const directDatabaseUrl = z
  .string()
  .url()
  .parse(process.env.SUPABASE_DIRECT_DATABASE_URL);
const identityStore = new PostgresAuthStore(
  directDatabaseUrl,
  serverConfig.SUPABASE_SCHEMA,
);
const authService = new AuthService(identityStore, {
  chainId: serverConfig.CHAIN_ID,
  domain: new URL(serviceConfig.WEB_ORIGIN).host,
  origin: serviceConfig.WEB_ORIGIN,
});
const identityService = new IdentityService(identityStore);
const externalMarketService = new ExternalMarketService(
  directDatabaseUrl,
  serverConfig.SUPABASE_SCHEMA,
);
const protocolStore = new PostgresProtocolReadStore(
  directDatabaseUrl,
  serverConfig.SUPABASE_SCHEMA,
);
const chainClient = createPublicClient({
  transport: http(serverConfig.RPC_URL),
});
const protocolService = new ProtocolService(protocolStore, () =>
  chainClient.getBlockNumber(),
);
const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const manifest = await loadDeploymentManifestFile(
  resolve(projectRoot, serverConfig.DEPLOYMENT_MANIFEST_PATH),
  { environment: serverConfig.APP_ENV, chainId: serverConfig.CHAIN_ID },
);
const protocolAddresses = resolveProtocolAddresses(manifest, {
  environment: serverConfig.APP_ENV,
  chainId: serverConfig.CHAIN_ID,
});
const swapService = new SwapService(
  chainClient,
  protocolAddresses,
  serverConfig.CHAIN_ID,
  (pool) =>
    chainClient.readContract({
      address: protocolAddresses.poolRegistry,
      abi: poolRegistryAbi,
      functionName: "isRegisteredPool",
      args: [pool],
    }),
);
const tradeReceiptService = new TradeReceiptService(
  chainClient,
  externalMarketService,
  identityStore,
  serverConfig.CHAIN_ID,
  protocolAddresses.swapRouter,
);
const liquidityService = new LiquidityService(
  chainClient,
  protocolAddresses,
  serverConfig.CHAIN_ID,
  (pool) =>
    chainClient.readContract({
      address: protocolAddresses.poolRegistry,
      abi: poolRegistryAbi,
      functionName: "isRegisteredPool",
      args: [pool],
    }),
);
const market = JSON.parse(
  await readFile(
    resolve(projectRoot, `deployments/${serverConfig.APP_ENV}/market.json`),
    "utf8",
  ),
) as { pool: { address: string } };
const operationsService = new OperationsService(
  protocolService,
  liquidityService,
  chainClient,
  getAddress(market.pool.address),
  {
    rpcLagBlocks: BigInt(serviceConfig.ALERT_RPC_LAG_BLOCKS),
    checkpointAgeSeconds: serviceConfig.ALERT_CHECKPOINT_AGE_SECONDS,
    recentTransactionFailures: serviceConfig.ALERT_TRANSACTION_FAILURES,
    externalRouteAgeSeconds: serviceConfig.ALERT_EXTERNAL_ROUTE_AGE_SECONDS,
    receiptFailures: serviceConfig.ALERT_RECEIPT_FAILURES,
  },
  undefined,
  externalMarketService,
  tradeReceiptService,
);
const shieldedService = manifest.shielded
  ? new ShieldedService(chainClient, {
      vault: getAddress(manifest.shielded.vault),
      fieldHasher: getAddress(manifest.shielded.fieldHasher),
      deploymentBlock: BigInt(manifest.shielded.deploymentBlock),
    })
  : undefined;
const app = createApp(
  {
    environment: serverConfig.APP_ENV,
    chainId: serverConfig.CHAIN_ID,
    chainName: serverConfig.CHAIN_NAME,
    explorerUrl: serverConfig.BLOCK_EXPLORER_URL,
    webOrigin: serviceConfig.WEB_ORIGIN,
    ...(manifest.shielded
      ? {
          shielded: {
            vaultAddress: manifest.shielded.vault,
            stateRegistryAddress: manifest.shielded.stateRegistry,
            treeVersion: manifest.shielded.treeVersion,
            assets: manifest.shielded.assets,
          },
        }
      : {}),
  },
  {
    authService,
    identityService,
    protocolService,
    swapService,
    liquidityService,
    operationsService,
    externalMarketService,
    tradeReceiptService,
    ...(shieldedService ? { shieldedService } : {}),
  },
);

const listenHost = process.env.RAILWAY_ENVIRONMENT ? "0.0.0.0" : "127.0.0.1";

app.listen(serviceConfig.API_PORT, listenHost, () => {
  console.log(
    JSON.stringify({
      service: "api",
      status: "ready",
      environment: serverConfig.APP_ENV,
      chainId: serverConfig.CHAIN_ID,
      port: serviceConfig.API_PORT,
    }),
  );
});
