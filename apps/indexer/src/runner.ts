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

const runnerSchema = z.object({
  SUPABASE_DIRECT_DATABASE_URL: z.string().url(),
  INDEXER_CONFIRMATIONS: z.coerce.number().int().min(0).default(5),
  INDEXER_POLL_INTERVAL_MS: z.coerce.number().int().min(1_000).default(5_000),
  INDEXER_BATCH_SIZE: z.coerce.number().int().min(1).max(1_000).default(20),
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
const client = createPublicClient({ transport: http(config.RPC_URL) });
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
let syncing = false;

async function synchronize(): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    const pools = await repository.registeredPoolAddresses(config.CHAIN_ID);
    for (const pool of pools) {
      if (!addresses.includes(pool)) addresses.push(pool);
    }
    const checkpoint = await service.sync(
      BigInt(
        manifest.shielded
          ? Math.min(
              manifest.deploymentBlock,
              manifest.shielded.deploymentBlock,
            )
          : manifest.deploymentBlock,
      ),
      BigInt(runner.INDEXER_BATCH_SIZE),
    );
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
            error instanceof Error ? error.message : "Unknown indexer error",
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
