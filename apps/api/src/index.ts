import { perpEngineAbi, poolRegistryAbi, shieldedPerpAdapterAbi } from "@zkblast/abi";
import { loadServerConfig } from "@zkblast/config";
import {
  loadDeploymentManifestFile,
  verifyPrivateV2Deployment,
  type PrivateV2RpcRequest,
} from "@zkblast/config/node";
import { resolveProtocolAddresses } from "@zkblast/sdk";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, getAddress, http, keccak256 } from "viem";
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
import { PoolCreationService } from "./pool-creation-service.js";
import { PerpsService } from "./perps-service.js";

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
  OPERATIONS_API_TOKEN: z.string().min(32),
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
const perpVaultDeployment = Object.values(manifest.contracts).find(
  (contract) => contract.contractName === "LiquidityVaultUSDG",
);
const usdgAsset = manifest.shielded?.assets.find((asset) => asset.symbol === "USDG");
const perpsService = new PerpsService(
  directDatabaseUrl,
  serverConfig.SUPABASE_SCHEMA,
  perpVaultDeployment && (manifest.perps || usdgAsset)
    ? {
        chainId: serverConfig.CHAIN_ID,
        vault: getAddress(
          perpVaultDeployment.proxyAddress ?? perpVaultDeployment.implementationAddress,
        ),
        collateral: getAddress(manifest.perps?.collateral ?? usdgAsset!.address),
        ...(manifest.perps
          ? {
              privateExecution: {
                adapter: getAddress(manifest.perps.shieldedAdapter),
                relayer: getAddress(manifest.perps.relayer.address),
                feeRaw: BigInt(manifest.perps.relayer.feeRaw),
              },
            }
          : {}),
      }
    : undefined,
  manifest.perps
    ? async (positionId) => chainClient.readContract({
        address: getAddress(manifest.perps!.engine),
        abi: perpEngineAbi,
        functionName: "quoteClose",
        args: [positionId],
      })
    : undefined,
  manifest.perps
    ? async (positionId, leverageBps, externalFeeRaw) => chainClient.readContract({
        address: getAddress(manifest.perps!.engine),
        abi: perpEngineAbi,
        functionName: "quoteModify",
        args: [positionId, leverageBps, externalFeeRaw],
      })
    : undefined,
  manifest.perps
    ? async (positionId) => chainClient.readContract({
        address: getAddress(manifest.perps!.shieldedAdapter),
        abi: shieldedPerpAdapterAbi,
        functionName: "liquidatedResidual",
        args: [positionId],
      })
    : undefined,
);
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
const poolCreationService = new PoolCreationService(
  chainClient,
  protocolAddresses.poolFactory,
  protocolAddresses.poolRegistry,
  serverConfig.CHAIN_ID,
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
const marketPath = resolve(
  projectRoot,
  `deployments/${serverConfig.APP_ENV}/market.json`,
);
let operationsService: OperationsService | undefined;
try {
  const market = JSON.parse(await readFile(marketPath, "utf8")) as {
    pool: { address: string };
  };
  operationsService = new OperationsService(
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
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
    throw error;
  }
}
const shieldedService = manifest.shielded
  ? new ShieldedService(chainClient, {
      vault: getAddress(manifest.shielded.vault),
      fieldHasher: getAddress(manifest.shielded.fieldHasher),
      deploymentBlock: BigInt(manifest.shielded.deploymentBlock),
    })
  : undefined;
await verifyPrivateV2Deployment(
  {
    environment: serverConfig.APP_ENV,
    chainId: serverConfig.CHAIN_ID,
    config: manifest.shieldedV2,
    legacyVault: manifest.shielded?.vault,
  },
  chainClient.request as PrivateV2RpcRequest,
  keccak256,
);
const shieldedV2Service = manifest.shieldedV2
  ? new ShieldedService(chainClient, {
      schemaVersion: 2,
      vault: getAddress(manifest.shieldedV2.vault),
      fieldHasher: getAddress(manifest.shieldedV2.fieldHasher),
      deploymentBlock: BigInt(manifest.shieldedV2.deploymentBlock),
    })
  : undefined;
const app = createApp(
  {
    environment: serverConfig.APP_ENV,
    chainId: serverConfig.CHAIN_ID,
    chainName: serverConfig.CHAIN_NAME,
    explorerUrl: serverConfig.BLOCK_EXPLORER_URL,
    webOrigin: serviceConfig.WEB_ORIGIN,
    ...(manifest.shieldedV2 ? { shieldedV2: manifest.shieldedV2 } : {}),
    ...(manifest.perps ? { perps: manifest.perps } : {}),
    operationsToken: serviceConfig.OPERATIONS_API_TOKEN,
    contracts: Object.values(manifest.contracts)
      .map((contract) => ({
        name: contract.contractName,
        proxyKind: contract.proxyKind,
        address: contract.proxyAddress ?? contract.implementationAddress,
        proxyAddress: contract.proxyAddress,
        implementationAddress: contract.implementationAddress,
        verification: contract.verification,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    ...(manifest.shielded
      ? {
          shielded: {
            vaultAddress: manifest.shielded.vault,
            stateRegistryAddress: manifest.shielded.stateRegistry,
            treeVersion: manifest.shielded.treeVersion,
            ...(manifest.shielded.launchMode
              ? { launchMode: manifest.shielded.launchMode }
              : {}),
            ...(manifest.shielded.proverRelease
              ? { proverRelease: manifest.shielded.proverRelease }
              : {}),
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
    externalMarketService,
    tradeReceiptService,
    ...(operationsService ? { operationsService } : {}),
    ...(shieldedService ? { shieldedService } : {}),
    ...(shieldedV2Service ? { shieldedV2Service } : {}),
    poolCreationService,
    perpsService,
  },
);

const listenHost =
  process.env.HOST ??
  (process.env.RAILWAY_ENVIRONMENT ||
  process.env.NODE_ENV === "production"
    ? "0.0.0.0"
    : "127.0.0.1");

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
