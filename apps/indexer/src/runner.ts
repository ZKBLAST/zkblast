import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadServerConfig } from "@zkblast/config";
import { loadDeploymentManifestFile } from "@zkblast/config/node";
import { redact } from "@zkblast/observability";
import { createPublicClient, getAddress, http } from "viem";
import { z } from "zod";
import { IndexerService } from "./indexer-service.js";
import { PostgresIndexerRepository } from "./postgres-indexer-repository.js";
import { ViemChainReader } from "./viem-chain-reader.js";
import { marketChartSynchronizer } from "./market-chart-sync.js";
import { fastCatchup } from "./fast-catchup.js";
import { privateV2Synchronizer } from "./private-v2-sync.js";
import {
  deploymentAddress,
  PerpsStateSynchronizer,
} from "./perps-state-sync.js";

const runnerSchema = z.object({
  SUPABASE_DIRECT_DATABASE_URL: z.string().url(),
  INDEXER_CONFIRMATIONS: z.coerce.number().int().min(1).default(5),
  INDEXER_POLL_INTERVAL_MS: z.coerce.number().int().min(1_000).default(1_000),
  INDEXER_BATCH_SIZE: z.coerce.number().int().min(1).max(1_000).default(20),
  INDEXER_CATCHUP_CHUNK_SIZE: z.coerce
    .bigint()
    .min(1n)
    .max(10000n)
    .default(2000n),
  INDEXER_CATCHUP_MAX_BLOCKS: z.coerce
    .bigint()
    .min(1n)
    .max(10000000n)
    .default(100000n),
});
const config = loadServerConfig(process.env);
const runner = runnerSchema.parse(process.env);
const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const manifest = await loadDeploymentManifestFile(
  resolve(projectRoot, config.DEPLOYMENT_MANIFEST_PATH),
  { environment: config.APP_ENV, chainId: config.CHAIN_ID },
);
const configuredPerpsAddresses = manifest.perps
  ? [
      manifest.perps.registry,
      manifest.perps.oracle,
      manifest.perps.funding,
      manifest.perps.engine,
      manifest.perps.insuranceFund,
      manifest.perps.liquidityVault,
      manifest.perps.shieldedAdapter,
    ]
  : [];
const configuredDbcAddresses = manifest.dbc
  ? [
      manifest.dbc.configRegistry,
      manifest.dbc.launchFactory,
      manifest.dbc.curveQuoter,
      manifest.dbc.launchpadRouter,
      manifest.dbc.graduationManager,
      manifest.dbc.dammGraduationAdapter,
      manifest.dbc.lpAllocationEscrow,
    ]
  : [];
const addresses = [
  ...Object.values(manifest.integration),
  ...Object.values(manifest.contracts).map(
    (deployment) => deployment.proxyAddress ?? deployment.implementationAddress,
  ),
  ...(manifest.shieldedV2 ? [manifest.shieldedV2.vault] : []),
  ...(manifest.shielded
    ? [manifest.shielded.vault, manifest.shielded.stateRegistry]
    : []),
  ...configuredPerpsAddresses,
  ...configuredDbcAddresses,
]
  .map(getAddress)
  .filter((address, index, all) => all.indexOf(address) === index);
const client = createPublicClient({
  cacheTime: 0,
  transport: http(config.RPC_URL, { timeout: 20000, retryCount: 1 }),
});
const repository = new PostgresIndexerRepository(
  runner.SUPABASE_DIRECT_DATABASE_URL,
  config.SUPABASE_SCHEMA,
  "protocol",
  configuredDbcAddresses.map(getAddress),
);
const trackedLaunchTokens = manifest.dbc
  ? await repository.dbcLaunchTokenAddresses()
  : [];
const service = new IndexerService(
  config.CHAIN_ID,
  BigInt(runner.INDEXER_CONFIRMATIONS),
  new ViemChainReader(client, config.CHAIN_ID, [...addresses, ...trackedLaunchTokens]),
  repository,
);
await repository.enableCheckpointGuard();
const privateV2 = manifest.shieldedV2
  ? privateV2Synchronizer({
      client,
      databaseUrl: runner.SUPABASE_DIRECT_DATABASE_URL,
      schema: config.SUPABASE_SCHEMA,
      chainId: config.CHAIN_ID,
      registry: getAddress(manifest.integration.poolRegistry),
      vault: getAddress(manifest.shieldedV2.vault),
      deploymentBlock: manifest.shieldedV2.deploymentBlock,
      deployment: manifest.shieldedV2,
      legacyVault: manifest.shielded?.vault,
      confirmations: BigInt(runner.INDEXER_CONFIRMATIONS),
      chunkSize: runner.INDEXER_CATCHUP_CHUNK_SIZE,
      maximumBlocks: runner.INDEXER_CATCHUP_MAX_BLOCKS,
    })
  : undefined;
const perpsDeployments = {
  registry:
    manifest.perps?.registry ??
    deploymentAddress(manifest.contracts, "PerpMarketRegistry"),
  oracle:
    manifest.perps?.oracle ??
    deploymentAddress(manifest.contracts, "ChainlinkOracleAdapter"),
  engine:
    manifest.perps?.engine ??
    deploymentAddress(manifest.contracts, "PerpEngine"),
  funding:
    manifest.perps?.funding ??
    deploymentAddress(manifest.contracts, "FundingRateModule"),
  vault:
    manifest.perps?.liquidityVault ??
    deploymentAddress(manifest.contracts, "LiquidityVaultUSDG"),
  insurance:
    manifest.perps?.insuranceFund ??
    deploymentAddress(manifest.contracts, "InsuranceFund"),
};
const perpsState = new PerpsStateSynchronizer(
  runner.SUPABASE_DIRECT_DATABASE_URL,
  config.SUPABASE_SCHEMA,
  client,
  perpsDeployments.registry &&
    perpsDeployments.oracle &&
    perpsDeployments.engine &&
    perpsDeployments.funding &&
    perpsDeployments.vault &&
    perpsDeployments.insurance
    ? {
        registry: getAddress(perpsDeployments.registry),
        oracle: getAddress(perpsDeployments.oracle),
        engine: getAddress(perpsDeployments.engine),
        funding: getAddress(perpsDeployments.funding),
        vault: getAddress(perpsDeployments.vault),
        insurance: getAddress(perpsDeployments.insurance),
      }
    : undefined,
);
let syncing = false;
let lastActivitySync = 0;

async function synchronize(): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    await privateV2?.synchronize();
    const pools = await repository.registeredPoolAddresses(config.CHAIN_ID);
    for (const pool of pools) {
      if (!addresses.includes(pool)) addresses.push(pool);
    }
    const startBlock = BigInt(
      Math.min(
        manifest.deploymentBlock,
        manifest.shielded?.deploymentBlock ?? manifest.deploymentBlock,
        manifest.shieldedV2?.deploymentBlock ?? manifest.deploymentBlock,
      ),
    );
    try {
      await fastCatchup({
        client,
        repository,
        chainId: config.CHAIN_ID,
        registry: getAddress(manifest.integration.poolRegistry),
        addresses,
        fromBlock: startBlock,
        confirmations: BigInt(runner.INDEXER_CONFIRMATIONS),
        chunkSize: runner.INDEXER_CATCHUP_CHUNK_SIZE,
        maximumBlocks: runner.INDEXER_CATCHUP_MAX_BLOCKS,
      });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== "CATCHUP_REORG_REQUIRES_REWIND"
      )
        throw error;
      await service.sync(startBlock, 1n);
    }
    const checkpoint = await repository.checkpoint(config.CHAIN_ID);
    if (Date.now() - lastActivitySync >= 30000) {
      await repository.reconcilePools(
        client,
        config.CHAIN_ID,
        getAddress(manifest.integration.poolFactory),
        getAddress(manifest.integration.poolRegistry),
      );
      await repository.reconcileActivity(
        client,
        config.CHAIN_ID,
        getAddress(manifest.integration.positionManager),
        BigInt(runner.INDEXER_CONFIRMATIONS),
      );
      await perpsState.synchronize();
      lastActivitySync = Date.now();
    }
    console.log(
      JSON.stringify(
        redact({
          service: "indexer",
          status: "synced",
          chainId: config.CHAIN_ID,
          blockNumber: checkpoint?.blockNumber.toString() ?? null,
          finalizedBlock: checkpoint?.finalizedBlock.toString() ?? null,
        }),
      ),
    );
  } catch (error) {
    console.error(
      JSON.stringify(
        redact({
          service: "indexer",
          status: "error",
          error:
            error instanceof Error && /^[A-Z_]{4,80}$/u.test(error.message)
              ? error.message
              : error instanceof Error
                ? error.name
                : "INDEXER_FAILED",
        }),
      ),
    );
  } finally {
    syncing = false;
  }
}

await synchronize();
const charts = marketChartSynchronizer(
  config,
  getAddress(manifest.integration.poolRegistry),
);
void charts
  .synchronize()
  .catch(() => console.error("Chart source sync unavailable"));
setInterval(() => {
  void charts
    .synchronize()
    .catch(() => console.error("Chart source sync unavailable"));
}, charts.intervalMs);
setInterval(() => {
  void synchronize();
}, runner.INDEXER_POLL_INTERVAL_MS);
