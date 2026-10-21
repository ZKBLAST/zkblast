import path from "node:path";
import { loadServerConfig, isPrivateV2Network } from "@zkblast/config";
import { loadDeploymentManifestFile } from "@zkblast/config/node";
import { createPublicClient, http, getAddress } from "viem";
import { privateV2Synchronizer } from "./private-v2-sync.js";
import { PostgresIndexerRepository } from "./postgres-indexer-repository.js";

async function main() {
  const config = loadServerConfig(process.env);
  if (
    !isPrivateV2Network(config.APP_ENV, config.CHAIN_ID) ||
    config.SUPABASE_SCHEMA !== `zkblast_${config.APP_ENV}` ||
    !process.env.SUPABASE_DIRECT_DATABASE_URL
  )
    throw new Error("V2_NETWORK_SCHEMA_REQUIRED");
  const manifest = await loadDeploymentManifestFile(
    path.resolve(
      import.meta.dirname,
      "../../..",
      config.DEPLOYMENT_MANIFEST_PATH,
    ),
    { environment: config.APP_ENV, chainId: config.CHAIN_ID },
  );
  if (!manifest.shieldedV2) throw new Error("V2_MANIFEST_REQUIRED");
  const guard = new PostgresIndexerRepository(
    process.env.SUPABASE_DIRECT_DATABASE_URL,
    config.SUPABASE_SCHEMA,
  );
  try {
    await guard.enableCheckpointGuard();
  } finally {
    await guard.close();
  }
  const sync = privateV2Synchronizer({
    client: createPublicClient({
      transport: http(config.RPC_URL, { timeout: 20000, retryCount: 0 }),
    }),
    databaseUrl: process.env.SUPABASE_DIRECT_DATABASE_URL,
    schema: config.SUPABASE_SCHEMA,
    chainId: config.CHAIN_ID,
    registry: getAddress(manifest.integration.poolRegistry),
    vault: getAddress(manifest.shieldedV2.vault),
    deploymentBlock: manifest.shieldedV2.deploymentBlock,
    deployment: manifest.shieldedV2,
    legacyVault: manifest.shielded?.vault,
    confirmations: 5n,
    chunkSize: 2000n,
    maximumBlocks: 100000n,
  });
  try {
    console.log(JSON.stringify(await sync.synchronize()));
  } finally {
    await sync.close();
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error && /^[A-Z_]+$/u.test(error.message)
      ? error.message
      : "PRIVATE_V2_SYNC_FAILED",
  );
  process.exitCode = 1;
});
