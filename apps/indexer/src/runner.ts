import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadServerConfig, parseDeploymentManifest } from "@zkblast/config";
import { redact } from "@zkblast/observability";
import { createPublicClient, getAddress, http } from "viem";
import { z } from "zod";
import { IndexerService } from "./indexer-service.js";
import { PostgresIndexerRepository } from "./postgres-indexer-repository.js";
import { ViemChainReader } from "./viem-chain-reader.js";

const runnerSchema = z.object({
  SUPABASE_DIRECT_DATABASE_URL: z.string().url(),
  INDEXER_CONFIRMATIONS: z.coerce.number().int().min(0).default(5),
  INDEXER_POLL_INTERVAL_MS: z.coerce.number().int().min(1_000).default(5_000),
  INDEXER_BATCH_SIZE: z.coerce.number().int().min(1).max(1_000).default(20),
});
const config = loadServerConfig(process.env);
const runner = runnerSchema.parse(process.env);
const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const manifest = parseDeploymentManifest(
  JSON.parse(
    await readFile(resolve(projectRoot, config.DEPLOYMENT_MANIFEST_PATH), "utf8"),
  ),
  { environment: config.APP_ENV, chainId: config.CHAIN_ID },
);
const addresses = Object.values(manifest.integration).map(getAddress);
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
    const checkpoint = await service.sync(
      BigInt(manifest.deploymentBlock),
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
setInterval(() => {
  void synchronize();
}, runner.INDEXER_POLL_INTERVAL_MS);
