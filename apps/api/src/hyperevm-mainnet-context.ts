import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  launchConfigRegistryAbi,
  erc20Abi,
  launchpadConfigManagerAbi,
  launchpadRegistryAbi,
  poolRegistryAbi,
  virtualPoolAbi,
} from "@zkblast/abi";
import { loadDeploymentManifestFile } from "@zkblast/config/node";
import {
  resolveDbcAddresses,
  resolveLaunchpadAddresses,
  resolveProtocolAddresses,
} from "@zkblast/sdk";
import { createPublicClient, getAddress, http } from "viem";
import type { ApiChainContext } from "./app.js";
import { DbcService } from "./dbc-service.js";
import { LaunchpadBrandingService } from "./launchpad-branding-service.js";
import { LaunchpadCatalogService } from "./launchpad-catalog-service.js";
import { LaunchpadReadService } from "./launchpad-read-service.js";
import { LiquidityService } from "./liquidity-service.js";
import { IndexerOperationsService } from "./operations-service.js";
import { PoolCreationService } from "./pool-creation-service.js";
import { PostgresDbcReadStore } from "./postgres-dbc-read-store.js";
import { PostgresLaunchpadBrandingStore } from "./postgres-launchpad-branding-store.js";
import { PostgresLaunchpadReadStore } from "./postgres-launchpad-read-store.js";
import { PostgresProtocolReadStore } from "./postgres-protocol-read-store.js";
import { ProtocolService } from "./protocol-service.js";
import { publicContractDirectory } from "./public-contract-directory.js";
import { SwapService } from "./swap-service.js";

const CHAIN_ID = 999;
const SCHEMA = "zkblast_hyperevm_mainnet";
const MANIFEST_PATH = "deployments/hyperevm-mainnet/manifest.json";

export async function createHyperEvmMainnetContext(input: Readonly<{
  databaseUrl: string;
  rpcUrl: string;
  webOrigin: string;
  operationsToken?: string;
  rpcLagBlocks: number;
  checkpointAgeSeconds: number;
}>): Promise<ApiChainContext> {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const manifest = await loadDeploymentManifestFile(resolve(root, MANIFEST_PATH), {
    environment: "mainnet",
    chainId: CHAIN_ID,
  });
  if (!manifest.dbc || !manifest.launchpad)
    throw new Error("HYPEREVM_MAINNET_CAPABILITY_MANIFEST_INCOMPLETE");

  const client = createPublicClient({ cacheTime: 0, transport: http(input.rpcUrl) });
  if ((await client.getChainId()) !== CHAIN_ID)
    throw new Error("HYPEREVM_MAINNET_RPC_CHAIN_MISMATCH");

  const protocolAddresses = resolveProtocolAddresses(manifest, {
    environment: "mainnet",
    chainId: CHAIN_ID,
  });
  const dbcAddresses = resolveDbcAddresses(manifest, {
    environment: "mainnet",
    chainId: CHAIN_ID,
  });
  const launchpadAddresses = resolveLaunchpadAddresses(manifest, {
    environment: "mainnet",
    chainId: CHAIN_ID,
  });
  const protocolService = new ProtocolService(
    new PostgresProtocolReadStore(input.databaseUrl, SCHEMA),
    () => client.getBlockNumber(),
  );
  const operationsService = new IndexerOperationsService(
    protocolService,
    CHAIN_ID,
    {
      rpcLagBlocks: BigInt(input.rpcLagBlocks),
      checkpointAgeSeconds: input.checkpointAgeSeconds,
    },
  );
  const poolRegistered = (pool: `0x${string}`) =>
    client.readContract({
      address: protocolAddresses.poolRegistry,
      abi: poolRegistryAbi,
      functionName: "isRegisteredPool",
      args: [pool],
    });
  const swapService = new SwapService(
    client,
    protocolAddresses,
    CHAIN_ID,
    poolRegistered,
  );
  const liquidityService = new LiquidityService(
    client,
    protocolAddresses,
    CHAIN_ID,
    poolRegistered,
    manifest.contracts.DlmmLens
      ? {
          lens: getAddress(
            manifest.contracts.DlmmLens.proxyAddress ??
              manifest.contracts.DlmmLens.implementationAddress,
          ),
          blockNumber: () => client.getBlockNumber(),
        }
      : undefined,
  );
  const poolCreationService = new PoolCreationService(
    client,
    protocolAddresses.poolFactory,
    protocolAddresses.poolRegistry,
    CHAIN_ID,
  );
  const dbcService = new DbcService(
    new PostgresDbcReadStore(input.databaseUrl, SCHEMA, CHAIN_ID),
    {
      quote: ({ pool, side, amountRaw }) =>
        client.readContract({
          address: pool,
          abi: virtualPoolAbi,
          functionName: side === "buy" ? "quoteBuyExactInput" : "quoteSellExactInput",
          args: [amountRaw],
        }),
      templateEconomics: (templateId) =>
        client.readContract({
          address: dbcAddresses.configRegistry,
          abi: launchConfigRegistryAbi,
          functionName: "templateEconomics",
          args: [templateId],
        }),
      templateConfig: (templateId) =>
        client.readContract({
          address: dbcAddresses.configRegistry,
          abi: launchConfigRegistryAbi,
          functionName: "templateConfig",
          args: [templateId],
        }),
      tokenMetadata: async (token) => {
        const [symbol, decimals] = await Promise.all([
          client.readContract({
            address: token,
            abi: erc20Abi,
            functionName: "symbol",
          }),
          client.readContract({
            address: token,
            abi: erc20Abi,
            functionName: "decimals",
          }),
        ]);
        return { symbol, decimals };
      },
    },
    dbcAddresses,
  );
  const launchpadCatalogService = new LaunchpadCatalogService(
    "mainnet",
    CHAIN_ID,
    launchpadAddresses,
    {
      launchpadCount: () =>
        client.readContract({
          address: launchpadAddresses.registry,
          abi: launchpadRegistryAbi,
          functionName: "launchpadCount",
        }),
      presetCount: () =>
        client.readContract({
          address: launchpadAddresses.configManager,
          abi: launchpadConfigManagerAbi,
          functionName: "presetCount",
        }),
      globalMaximumTotalTradeFeeBps: async () =>
        Number(
          await client.readContract({
            address: launchpadAddresses.configManager,
            abi: launchpadConfigManagerAbi,
            functionName: "globalMaximumTotalTradeFeeBps",
          }),
        ),
      destinationSupported: (destination) =>
        client.readContract({
          address: launchpadAddresses.configManager,
          abi: launchpadConfigManagerAbi,
          functionName: "destinationSupported",
          args: [destination],
        }),
      presets: async (ids) => {
        const items = await client.readContract({
          address: launchpadAddresses.configManager,
          abi: launchpadConfigManagerAbi,
          functionName: "presets",
          args: [[...ids]],
        });
        return items.map((item) => ({ ...item }));
      },
      launchpad: async (id) => {
        const item = await client.readContract({
          address: launchpadAddresses.registry,
          abi: launchpadRegistryAbi,
          functionName: "launchpad",
          args: [id],
        });
        return { ...item };
      },
      launchpads: async (ids) => {
        const items = await client.readContract({
          address: launchpadAddresses.registry,
          abi: launchpadRegistryAbi,
          functionName: "launchpads",
          args: [[...ids]],
        });
        return items.map((item) => ({ ...item }));
      },
    },
  );
  const launchpadReadService = new LaunchpadReadService(
    "mainnet",
    CHAIN_ID,
    new PostgresLaunchpadReadStore(input.databaseUrl, SCHEMA, CHAIN_ID),
    dbcService,
    () => client.getBlockNumber(),
  );
  const launchpadBrandingService = new LaunchpadBrandingService(
    CHAIN_ID,
    new PostgresLaunchpadBrandingStore(input.databaseUrl, SCHEMA, CHAIN_ID),
    {
      launchpad: async (launchpadId) => {
        const record = await client.readContract({
          address: launchpadAddresses.registry,
          abi: launchpadRegistryAbi,
          functionName: "launchpad",
          args: [launchpadId],
        });
        return {
          owner: record.owner,
          metadataHash: record.metadataHash,
        };
      },
    },
  );

  return {
    config: {
      environment: "mainnet",
      chainId: CHAIN_ID,
      chainName: "HyperEVM",
      explorerUrl: "https://www.hyperscan.com",
      webOrigin: input.webOrigin,
      ...(input.operationsToken ? { operationsToken: input.operationsToken } : {}),
      contracts: publicContractDirectory(manifest),
    },
    dependencies: {
      protocolService,
      operationsService,
      swapService,
      liquidityService,
      poolCreationService,
      dbcService,
      launchpadCatalogService,
      launchpadReadService,
      launchpadBrandingService,
    },
  };
}
