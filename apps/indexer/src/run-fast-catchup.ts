import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadServerConfig } from "@zkblast/config";
import { loadDeploymentManifestFile } from "@zkblast/config/node";
import postgres from "postgres";
import { createPublicClient, getAddress, http } from "viem";
import { z } from "zod";
import { installCheckpointGuard } from "./checkpoint-guard.js";
import { PostgresIndexerRepository } from "./postgres-indexer-repository.js";
import { fastCatchup } from "./fast-catchup.js";

async function main() {
  const config = loadServerConfig(process.env);
  if (
    config.SUPABASE_SCHEMA !== `zkblast_${config.APP_ENV}` ||
    config.CHAIN_ID !== (config.APP_ENV === "mainnet" ? 4663 : 46630)
  )
    throw new Error("CATCHUP_ENVIRONMENT_MISMATCH");
  const settings = z
    .object({
      SUPABASE_DIRECT_DATABASE_URL: z.string().url(),
      INDEXER_CONFIRMATIONS: z.coerce.bigint().min(1n).default(5n),
      INDEXER_CATCHUP_CHUNK_SIZE: z.coerce
        .bigint()
        .min(1n)
        .max(10000n)
        .default(2000n),
      INDEXER_CATCHUP_MAX_BLOCKS: z.coerce
        .bigint()
        .min(1n)
        .max(10000000n)
        .default(3000000n),
    })
    .parse(process.env);
  const manifest = await loadDeploymentManifestFile(
    resolve(
      fileURLToPath(new URL("../../../", import.meta.url)),
      config.DEPLOYMENT_MANIFEST_PATH,
    ),
    { environment: config.APP_ENV, chainId: config.CHAIN_ID },
  );
  const sql = postgres(settings.SUPABASE_DIRECT_DATABASE_URL, {
    max: 1,
    prepare: false,
  });
  const repository = new PostgresIndexerRepository(
    settings.SUPABASE_DIRECT_DATABASE_URL,
    config.SUPABASE_SCHEMA,
  );
  try {
    const client = createPublicClient({
      transport: http(config.RPC_URL, { timeout: 20000, retryCount: 1 }),
    });
    if ((await client.getChainId()) !== config.CHAIN_ID)
      throw new Error("CATCHUP_CHAIN_MISMATCH");
    await installCheckpointGuard(sql, config.SUPABASE_SCHEMA);
    const addresses = [
      ...Object.values(manifest.integration),
      ...(manifest.shielded
        ? [manifest.shielded.vault, manifest.shielded.stateRegistry]
        : []),
      ...(await repository.registeredPoolAddresses(config.CHAIN_ID)),
    ].map(getAddress);
    let lastReported = 0;
    const result = process.argv.includes("--activity-only")
      ? {}
      : await fastCatchup({
          client,
          repository,
          chainId: config.CHAIN_ID,
          registry: getAddress(manifest.integration.poolRegistry),
          addresses: [...new Set(addresses)],
          fromBlock: BigInt(
            Math.min(
              manifest.deploymentBlock,
              manifest.shielded?.deploymentBlock ?? manifest.deploymentBlock,
            ),
          ),
          chunkSize: settings.INDEXER_CATCHUP_CHUNK_SIZE,
          confirmations: settings.INDEXER_CONFIRMATIONS,
          maximumBlocks: settings.INDEXER_CATCHUP_MAX_BLOCKS,
          onProgress: (checkpoint, finalized) => {
            if (Date.now() - lastReported < 15000) return;
            lastReported = Date.now();
            console.log(
              JSON.stringify({
                service: "fast-catchup",
                environment: config.APP_ENV,
                indexedBlock: checkpoint.blockNumber.toString(),
                lag: (finalized - checkpoint.blockNumber).toString(),
              }),
            );
          },
        });
    console.log(
      JSON.stringify({
        service: "fast-catchup",
        environment: config.APP_ENV,
        ...result,
        pools: await repository.reconcilePools(
          client,
          config.CHAIN_ID,
          getAddress(manifest.integration.poolFactory),
          getAddress(manifest.integration.poolRegistry),
        ),
        activity: await repository.reconcileActivity(
          client,
          config.CHAIN_ID,
          getAddress(manifest.integration.positionManager),
          settings.INDEXER_CONFIRMATIONS,
        ),
      }),
    );
  } finally {
    await repository.close();
    await sql.end();
  }
}
main().catch((error) => {
  console.error(
    JSON.stringify({
      service: "fast-catchup",
      status: "failed",
      code:
        error instanceof Error && /^[A-Z_]{4,80}$/u.test(error.message)
          ? error.message
          : "CATCHUP_FAILED",
    }),
  );
  process.exitCode = 1;
});
