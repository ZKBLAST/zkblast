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
const addresses = [
  ...Object.values(manifest.integration),
  ...(manifest.shielded
    ? [manifest.shielded.vault, manifest.shielded.stateRegistry]
    : []),
].map(getAddress);
const client = createPublicClient({
  cacheTime: 0,
  transport: http(config.RPC_URL, { timeout: 20000, retryCount: 1 }),
});
const repository = new PostgresIndexerRepository(
  runner.SUPABASE_DIRECT_DATABASE_URL,
  config.SUPABASE_SCHEMA,
);
const service = new IndexerService(
  config.CHAIN_ID,
  BigInt(runner.INDEXER_CONFIRMATIONS),
  new ViemChainReader(client, config.CHAIN_ID, addresses),
  repository,
);
await repository.enableCheckpointGuard();
let syncing = false;
let lastActivitySync = 0;

async function synchronize(): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    const pools = await repository.registeredPoolAddresses(config.CHAIN_ID);
    for (const pool of pools) {
      if (!addresses.includes(pool)) addresses.push(pool);
    }
    const startBlock = BigInt(
      manifest.shielded
        ? Math.min(manifest.deploymentBlock, manifest.shielded.deploymentBlock)
        : manifest.deploymentBlock,
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
