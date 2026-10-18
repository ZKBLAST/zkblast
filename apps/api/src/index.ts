import { poolRegistryAbi } from "@zkblast/abi";
import { loadServerConfig, parseDeploymentManifest } from "@zkblast/config";
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

const serviceSchema = z.object({
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  WEB_ORIGIN: z.string().url(),
  ALERT_RPC_LAG_BLOCKS: z.coerce.number().int().positive().default(25),
  ALERT_CHECKPOINT_AGE_SECONDS: z.coerce.number().int().positive().default(120),
  ALERT_TRANSACTION_FAILURES: z.coerce.number().int().positive().default(3),
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
const manifest = parseDeploymentManifest(
  JSON.parse(
    await readFile(
      resolve(projectRoot, serverConfig.DEPLOYMENT_MANIFEST_PATH),
      "utf8",
    ),
  ),
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
  },
);
const app = createApp(
  {
    environment: serverConfig.APP_ENV,
    chainId: serverConfig.CHAIN_ID,
    chainName: serverConfig.CHAIN_NAME,
    explorerUrl: serverConfig.BLOCK_EXPLORER_URL,
    webOrigin: serviceConfig.WEB_ORIGIN,
  },
  {
    authService,
    identityService,
    protocolService,
    swapService,
    liquidityService,
    operationsService,
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
