import {
  launchConfigRegistryAbi,
  erc20Abi,
  launchpadConfigManagerAbi,
  launchpadRegistryAbi,
  perpEngineAbi,
  poolRegistryAbi,
  shieldedPerpAdapterAbi,
  virtualPoolAbi,
} from "@zkblast/abi";
import { getChainDescriptor, loadServerConfig } from "@zkblast/config";
import {
  loadDeploymentManifestFile,
  verifyPrivateV2Deployment,
  type PrivateV2RpcRequest,
} from "@zkblast/config/node";
import {
  resolveDbcAddresses,
  resolveLaunchpadAddresses,
  resolveProtocolAddresses,
} from "@zkblast/sdk";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  fallback,
  getAddress,
  http,
  keccak256,
  parseAbi,
} from "viem";
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
import { DbcService } from "./dbc-service.js";
import { PostgresDbcReadStore } from "./postgres-dbc-read-store.js";
import { LaunchpadBrandingService } from "./launchpad-branding-service.js";
import { PostgresLaunchpadBrandingStore } from "./postgres-launchpad-branding-store.js";
import { LaunchpadDomainService } from "./launchpad-domain-service.js";
import { PostgresLaunchpadDomainStore } from "./postgres-launchpad-domain-store.js";
import { lookup, resolveTxt } from "node:dns/promises";
import { LaunchpadCatalogService } from "./launchpad-catalog-service.js";
import { LaunchpadReadService } from "./launchpad-read-service.js";
import { PostgresLaunchpadReadStore } from "./postgres-launchpad-read-store.js";
import { LaunchpadDeveloperService } from "./launchpad-developer-service.js";
import { PostgresLaunchpadDeveloperStore } from "./postgres-launchpad-developer-store.js";
import { probeWebhookOwnership } from "./launchpad-developer-security.js";
import { createHyperEvmMainnetContext } from "./hyperevm-mainnet-context.js";
import { publicContractDirectory } from "./public-contract-directory.js";
import { PostgresAssistanceFundService } from "./postgres-assistance-fund-service.js";

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
  LAUNCHPAD_WEBHOOK_ENCRYPTION_KEY: z.string().min(1).optional(),
  ROBINHOOD_MAINNET_WEB_URL: z.string().url().optional(),
  HYPEREVM_MAINNET_WEB_URL: z.string().url().optional(),
  ENABLE_HYPEREVM_MAINNET: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  HYPEREVM_MAINNET_RPC_URL: z
    .string()
    .url()
    .default("https://rpc.hyperliquid.xyz/evm"),
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
const primaryDescriptor = getChainDescriptor(serverConfig.CHAIN_ID);
const rpcUrls = [
  serverConfig.RPC_URL,
  ...primaryDescriptor.publicRpcUrls.filter(
    (url) => url !== serverConfig.RPC_URL,
  ),
];
const chainClient = createPublicClient({
  transport:
    rpcUrls.length === 1
      ? http(rpcUrls[0]!, { retryCount: 2, retryDelay: 500 })
      : fallback(
          rpcUrls.map((url) =>
            http(url, { retryCount: 1, retryDelay: 500, timeout: 20_000 }),
          ),
          { rank: true, retryCount: 2, retryDelay: 500 },
        ),
});
const protocolService = new ProtocolService(protocolStore, () =>
  chainClient.getBlockNumber(),
);
const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const manifest = await loadDeploymentManifestFile(
  resolve(projectRoot, serverConfig.DEPLOYMENT_MANIFEST_PATH),
  { environment: serverConfig.APP_ENV, chainId: serverConfig.CHAIN_ID },
);
const assistanceFundService = manifest.assistanceFund
  ? new PostgresAssistanceFundService(
      directDatabaseUrl,
      serverConfig.SUPABASE_SCHEMA,
    )
  : undefined;
const protocolAddresses = resolveProtocolAddresses(manifest, {
  environment: serverConfig.APP_ENV,
  chainId: serverConfig.CHAIN_ID,
});
const dbcAddresses = manifest.dbc
  ? resolveDbcAddresses(manifest, {
      environment: serverConfig.APP_ENV,
      chainId: serverConfig.CHAIN_ID,
    })
  : undefined;
const launchpadAddresses = manifest.launchpad
  ? resolveLaunchpadAddresses(manifest, {
      environment: serverConfig.APP_ENV,
      chainId: serverConfig.CHAIN_ID,
    })
  : undefined;
const launchpadWebhookEncryptionKey =
  serviceConfig.LAUNCHPAD_WEBHOOK_ENCRYPTION_KEY
    ? Buffer.from(serviceConfig.LAUNCHPAD_WEBHOOK_ENCRYPTION_KEY, "base64")
    : undefined;
if (
  launchpadWebhookEncryptionKey &&
  launchpadWebhookEncryptionKey.length !== 32
) {
  throw new Error("LAUNCHPAD_WEBHOOK_ENCRYPTION_KEY_INVALID");
}
const launchpadDeveloperService =
  launchpadAddresses && launchpadWebhookEncryptionKey
    ? new LaunchpadDeveloperService(
        serverConfig.CHAIN_ID,
        new PostgresLaunchpadDeveloperStore(
          directDatabaseUrl,
          serverConfig.SUPABASE_SCHEMA,
          serverConfig.CHAIN_ID,
        ),
        {
          owner: async (launchpadId) =>
            (
              await chainClient.readContract({
                address: launchpadAddresses.registry,
                abi: launchpadRegistryAbi,
                functionName: "launchpad",
                args: [launchpadId],
              })
            ).owner,
        },
        async (hostname) =>
          (await lookup(hostname, { all: true, verbatim: true })).map(
            ({ address }) => address,
          ),
        {
          verify: (url, token) =>
            probeWebhookOwnership(url, token, async (hostname) =>
              (await lookup(hostname, { all: true, verbatim: true })).map(
                ({ address }) => address,
              ),
            ),
        },
        launchpadWebhookEncryptionKey,
      )
    : undefined;
const launchpadCatalogService = launchpadAddresses
  ? new LaunchpadCatalogService(
      serverConfig.APP_ENV,
      serverConfig.CHAIN_ID,
      launchpadAddresses,
      {
        launchpadCount: () =>
          chainClient.readContract({
            address: launchpadAddresses.registry,
            abi: launchpadRegistryAbi,
            functionName: "launchpadCount",
          }),
        presetCount: () =>
          chainClient.readContract({
            address: launchpadAddresses.configManager,
            abi: launchpadConfigManagerAbi,
            functionName: "presetCount",
          }),
        globalMaximumTotalTradeFeeBps: async () =>
          Number(
            await chainClient.readContract({
              address: launchpadAddresses.configManager,
              abi: launchpadConfigManagerAbi,
              functionName: "globalMaximumTotalTradeFeeBps",
            }),
          ),
        destinationSupported: (destination) =>
          chainClient.readContract({
            address: launchpadAddresses.configManager,
            abi: launchpadConfigManagerAbi,
            functionName: "destinationSupported",
            args: [destination],
          }),
        presets: async (ids) => {
          const items = await chainClient.readContract({
            address: launchpadAddresses.configManager,
            abi: launchpadConfigManagerAbi,
            functionName: "presets",
            args: [[...ids]],
          });
          return items.map((item) => ({
            familyId: item.familyId,
            configHash: item.configHash,
            dbcTemplateId: item.dbcTemplateId,
            quoteToken: item.quoteToken,
            maximumTotalTradeFeeBps: item.maximumTotalTradeFeeBps,
            graduationDestination: item.graduationDestination,
            creatorAccess: item.creatorAccess,
            maximumLaunches: item.maximumLaunches,
            version: item.version,
            enabled: item.enabled,
            used: item.used,
          }));
        },
        launchpad: async (id) => {
          const item = await chainClient.readContract({
            address: launchpadAddresses.registry,
            abi: launchpadRegistryAbi,
            functionName: "launchpad",
            args: [id],
          });
          return {
            owner: item.owner,
            pendingOwner: item.pendingOwner,
            treasury: item.treasury,
            pendingTreasury: item.pendingTreasury,
            operator: item.operator,
            metadataHash: item.metadataHash,
            slugCommitment: item.slugCommitment,
            configPresetId: item.configPresetId,
            version: item.version,
            status: item.status,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
          };
        },
        launchpads: async (ids) => {
          const items = await chainClient.readContract({
            address: launchpadAddresses.registry,
            abi: launchpadRegistryAbi,
            functionName: "launchpads",
            args: [[...ids]],
          });
          return items.map((item) => ({
            owner: item.owner,
            pendingOwner: item.pendingOwner,
            treasury: item.treasury,
            pendingTreasury: item.pendingTreasury,
            operator: item.operator,
            metadataHash: item.metadataHash,
            slugCommitment: item.slugCommitment,
            configPresetId: item.configPresetId,
            version: item.version,
            status: item.status,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
          }));
        },
      },
    )
  : undefined;
const dbcService = dbcAddresses
  ? new DbcService(
      new PostgresDbcReadStore(
        directDatabaseUrl,
        serverConfig.SUPABASE_SCHEMA,
        serverConfig.CHAIN_ID,
      ),
      {
        quote: ({ pool, side, amountRaw }) =>
          chainClient.readContract({
            address: pool,
            abi: virtualPoolAbi,
            functionName:
              side === "buy" ? "quoteBuyExactInput" : "quoteSellExactInput",
            args: [amountRaw],
          }),
        templateEconomics: (templateId) =>
          chainClient.readContract({
            address: dbcAddresses.configRegistry,
            abi: launchConfigRegistryAbi,
            functionName: "templateEconomics",
            args: [templateId],
          }),
        templateConfig: (templateId) =>
          chainClient.readContract({
            address: dbcAddresses.configRegistry,
            abi: launchConfigRegistryAbi,
            functionName: "templateConfig",
            args: [templateId],
          }),
        tokenMetadata: async (token) => {
          const [symbol, decimals] = await Promise.all([
            chainClient.readContract({
              address: token,
              abi: erc20Abi,
              functionName: "symbol",
            }),
            chainClient.readContract({
              address: token,
              abi: erc20Abi,
              functionName: "decimals",
            }),
          ]);
          return { symbol, decimals };
        },
      },
      dbcAddresses,
    )
  : undefined;
const launchpadReadService = launchpadAddresses
  ? new LaunchpadReadService(
      serverConfig.APP_ENV,
      serverConfig.CHAIN_ID,
      new PostgresLaunchpadReadStore(
        directDatabaseUrl,
        serverConfig.SUPABASE_SCHEMA,
        serverConfig.CHAIN_ID,
      ),
      dbcService,
      () => chainClient.getBlockNumber(),
    )
  : undefined;
const launchpadBrandingService = manifest.launchpad
  ? new LaunchpadBrandingService(
      serverConfig.CHAIN_ID,
      new PostgresLaunchpadBrandingStore(
        directDatabaseUrl,
        serverConfig.SUPABASE_SCHEMA,
        serverConfig.CHAIN_ID,
      ),
      {
        launchpad: async (launchpadId) => {
          const record = await chainClient.readContract({
            address: getAddress(manifest.launchpad!.registry),
            abi: parseAbi([
              "function launchpad(uint256) view returns ((address owner,address pendingOwner,address treasury,address pendingTreasury,address operator,bytes32 metadataHash,bytes32 slugCommitment,uint256 configPresetId,uint32 version,uint8 status,uint64 createdAt,uint64 updatedAt) record)",
            ]),
            functionName: "launchpad",
            args: [launchpadId],
          });
          return { owner: record.owner, metadataHash: record.metadataHash };
        },
      },
    )
  : undefined;
const launchpadOwnershipReader = manifest.launchpad
  ? {
      launchpad: async (launchpadId: bigint) => {
        const record = await chainClient.readContract({
          address: getAddress(manifest.launchpad!.registry),
          abi: parseAbi([
            "function launchpad(uint256) view returns ((address owner,address pendingOwner,address treasury,address pendingTreasury,address operator,bytes32 metadataHash,bytes32 slugCommitment,uint256 configPresetId,uint32 version,uint8 status,uint64 createdAt,uint64 updatedAt) record)",
          ]),
          functionName: "launchpad",
          args: [launchpadId],
        });
        return { owner: record.owner, metadataHash: record.metadataHash };
      },
    }
  : undefined;
const launchpadDomainService = launchpadOwnershipReader
  ? new LaunchpadDomainService(
      serverConfig.CHAIN_ID,
      new PostgresLaunchpadDomainStore(
        directDatabaseUrl,
        serverConfig.SUPABASE_SCHEMA,
        serverConfig.CHAIN_ID,
      ),
      launchpadOwnershipReader,
      { resolveTxt },
    )
  : undefined;
const perpVaultDeployment = Object.values(manifest.contracts).find(
  (contract) => contract.contractName === "LiquidityVaultUSDG",
);
const perpVaultAddress =
  manifest.perps?.liquidityVault ??
  perpVaultDeployment?.proxyAddress ??
  perpVaultDeployment?.implementationAddress;
const usdgAsset = manifest.shielded?.assets.find(
  (asset) => asset.symbol === "USDG",
);
const perpsService = new PerpsService(
  directDatabaseUrl,
  serverConfig.SUPABASE_SCHEMA,
  perpVaultAddress && (manifest.perps || usdgAsset)
    ? {
        chainId: serverConfig.CHAIN_ID,
        vault: getAddress(perpVaultAddress),
        collateral: getAddress(
          manifest.perps?.collateral ?? usdgAsset!.address,
        ),
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
    ? async (positionId) =>
        chainClient.readContract({
          address: getAddress(manifest.perps!.engine),
          abi: perpEngineAbi,
          functionName: "quoteClose",
          args: [positionId],
        })
    : undefined,
  manifest.perps
    ? async (positionId, leverageBps, externalFeeRaw) =>
        chainClient.readContract({
          address: getAddress(manifest.perps!.engine),
          abi: perpEngineAbi,
          functionName: "quoteModify",
          args: [positionId, leverageBps, externalFeeRaw],
        })
    : undefined,
  manifest.perps
    ? async (positionId) =>
        chainClient.readContract({
          address: getAddress(manifest.perps!.shieldedAdapter),
          abi: shieldedPerpAdapterAbi,
          functionName: "liquidatedResidual",
          args: [positionId],
        })
    : undefined,
  manifest.perps
    ? async ({ from, to, data }) => {
        await chainClient.call({ account: from, to, data });
      }
    : undefined,
  manifest.perps
    ? async (oracleId) =>
        chainClient.readContract({
          address: getAddress(manifest.perps!.oracle),
          abi: parseAbi([
            "function latestPrice(bytes32) view returns ((uint256 value,uint64 updatedAt) price)",
          ]),
          functionName: "latestPrice",
          args: [oracleId],
        })
    : undefined,
  manifest.perps
    ? async (positionId) =>
        chainClient.readContract({
          address: getAddress(manifest.perps!.engine),
          abi: parseAbi([
            "function getPosition(bytes32) view returns ((bytes32 marketId,bytes32 ownerCommitment,uint128 marginUsd,uint128 notionalUsd,uint128 baseSize,uint128 entryPriceX18,int128 fundingIndexX18,uint64 openedAt,bool isLong) position)",
          ]),
          functionName: "getPosition",
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
try {
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
} catch (error) {
  if (
    !(error instanceof Error) ||
    error.message !== "V2_DEPLOYMENT_VERIFICATION_UNAVAILABLE"
  ) {
    throw error;
  }

  // A rate-limited or temporarily unavailable RPC must not take the public API
  // offline. Deterministic manifest/state mismatches still fail startup above.
  console.warn(
    JSON.stringify({
      service: "api",
      event: "shielded-v2-startup-verification-deferred",
      chainId: serverConfig.CHAIN_ID,
    }),
  );
}
const shieldedV2Service = manifest.shieldedV2
  ? new ShieldedService(chainClient, {
      schemaVersion: 2,
      vault: getAddress(manifest.shieldedV2.vault),
      fieldHasher: getAddress(manifest.shieldedV2.fieldHasher),
      deploymentBlock: BigInt(manifest.shieldedV2.deploymentBlock),
    })
  : undefined;
const additionalChainContexts = serviceConfig.ENABLE_HYPEREVM_MAINNET
  ? [
      await createHyperEvmMainnetContext({
        databaseUrl: directDatabaseUrl,
        rpcUrl: serviceConfig.HYPEREVM_MAINNET_RPC_URL,
        webOrigin: serviceConfig.WEB_ORIGIN,
        operationsToken: serviceConfig.OPERATIONS_API_TOKEN,
        rpcLagBlocks: serviceConfig.ALERT_RPC_LAG_BLOCKS,
        checkpointAgeSeconds: serviceConfig.ALERT_CHECKPOINT_AGE_SECONDS,
      }),
    ]
  : [];
const app = createApp(
  {
    environment: serverConfig.APP_ENV,
    chainId: serverConfig.CHAIN_ID,
    chainName: serverConfig.CHAIN_NAME,
    explorerUrl: serverConfig.BLOCK_EXPLORER_URL,
    webOrigin: serviceConfig.WEB_ORIGIN,
    chainAppUrls: {
      ...(serviceConfig.ROBINHOOD_MAINNET_WEB_URL
        ? { 4663: serviceConfig.ROBINHOOD_MAINNET_WEB_URL }
        : {}),
      ...(serviceConfig.HYPEREVM_MAINNET_WEB_URL
        ? { 999: serviceConfig.HYPEREVM_MAINNET_WEB_URL }
        : {}),
    },
    ...(manifest.shieldedV2 ? { shieldedV2: manifest.shieldedV2 } : {}),
    ...(manifest.perps ? { perps: manifest.perps } : {}),
    operationsToken: serviceConfig.OPERATIONS_API_TOKEN,
    contracts: publicContractDirectory(manifest),
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
    ...(dbcService ? { dbcService } : {}),
    ...(launchpadCatalogService ? { launchpadCatalogService } : {}),
    ...(launchpadReadService ? { launchpadReadService } : {}),
    ...(launchpadBrandingService ? { launchpadBrandingService } : {}),
    ...(launchpadDomainService ? { launchpadDomainService } : {}),
    ...(launchpadDeveloperService ? { launchpadDeveloperService } : {}),
    ...(assistanceFundService ? { assistanceFundService } : {}),
  },
  additionalChainContexts,
);

const listenHost =
  process.env.HOST ??
  (process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === "production"
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
