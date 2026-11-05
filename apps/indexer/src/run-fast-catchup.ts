import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getChainDescriptor, loadServerConfig } from "@zkblast/config";
import { loadDeploymentManifestFile } from "@zkblast/config/node";
import postgres from "postgres";
import { createPublicClient, getAddress } from "viem";
import { z } from "zod";
import { installCheckpointGuard } from "./checkpoint-guard.js";
import { PostgresIndexerRepository } from "./postgres-indexer-repository.js";
import { fastCatchup } from "./fast-catchup.js";
import { createIndexerTransport } from "./rpc-transport.js";

async function main() {
  const config = loadServerConfig(process.env);
  const descriptor = getChainDescriptor(config.CHAIN_ID);
  if (
    config.APP_ENV !== descriptor.environment ||
    config.SUPABASE_SCHEMA !== descriptor.databaseSchema
  )
    throw new Error("CATCHUP_ENVIRONMENT_MISMATCH");
  const settings = z
    .object({
      SUPABASE_DIRECT_DATABASE_URL: z.string().url(),
      INDEXER_CONFIRMATIONS: z.preprocess(
        (value) => value === "" ? undefined : value,
        z.coerce.bigint().min(1n).optional(),
      ),
      INDEXER_CATCHUP_CHUNK_SIZE: z.preprocess(
        (value) => value === "" ? undefined : value,
        z.coerce.bigint().min(1n).max(10000n).optional(),
      ),
      INDEXER_CATCHUP_MAX_BLOCKS: z.coerce
        .bigint()
        .min(1n)
        .max(10000000n)
        .default(3000000n),
      INDEXER_RPC_RANGE_DELAY_MS: z.coerce
        .number()
        .int()
        .min(0)
        .max(10_000)
        .optional(),
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
    const confirmations =
      settings.INDEXER_CONFIRMATIONS ??
      BigInt(descriptor.indexer.confirmations ?? 1);
    const chunkSize =
      settings.INDEXER_CATCHUP_CHUNK_SIZE ??
      BigInt(descriptor.indexer.maximumLogRange ?? 2_000);
    const client = createPublicClient({
      transport: createIndexerTransport(config.RPC_URL),
    });
    if ((await client.getChainId()) !== config.CHAIN_ID)
      throw new Error("CATCHUP_CHAIN_MISMATCH");
    await installCheckpointGuard(sql, config.SUPABASE_SCHEMA);
    const addresses = [
      ...Object.values(manifest.integration),
      ...(manifest.launchpad
        ? [
            manifest.launchpad.registry,
            manifest.launchpad.configManager,
            manifest.launchpad.factory,
            manifest.launchpad.feeController,
            manifest.launchpad.revenueSplitter,
            manifest.launchpad.feeCollector,
            manifest.launchpad.tokenFactory,
          ]
        : []),
      ...(manifest.dbc
        ? Object.values(manifest.dbc).filter(
            (value): value is string =>
              typeof value === "string" && /^0x[0-9a-f]{40}$/iu.test(value),
          )
        : []),
      ...(manifest.protectedLaunch
        ? Object.values(manifest.protectedLaunch).filter(
            (value): value is string =>
              typeof value === "string" && /^0x[0-9a-f]{40}$/iu.test(value),
          )
        : []),
      ...(manifest.stockQuoteAssets
        ? [
            manifest.stockQuoteAssets.adapterRegistry,
            manifest.stockQuoteAssets.assetRegistry,
            manifest.stockQuoteAssets.oracleGuard,
            manifest.stockQuoteAssets.destinationRegistry,
          ]
        : []),
      ...(manifest.shielded
        ? [manifest.shielded.vault, manifest.shielded.stateRegistry]
        : []),
      ...(await repository.registeredPoolAddresses(config.CHAIN_ID)),
      ...(await repository.dbcLaunchContractAddresses()),
    ]
      .filter((address): address is string => typeof address === "string")
      .map(getAddress);
    repository.trackDbcContracts([
      ...(manifest.dbc
        ? Object.values(manifest.dbc)
            .filter(
              (value): value is string =>
                typeof value === "string" && /^0x[0-9a-f]{40}$/iu.test(value),
            )
            .map(getAddress)
        : []),
      ...(manifest.launchpad
        ? Object.values(manifest.launchpad)
            .filter(
              (value): value is string =>
                typeof value === "string" && /^0x[0-9a-f]{40}$/iu.test(value),
            )
            .map(getAddress)
        : []),
      ...(manifest.protectedLaunch
        ? Object.values(manifest.protectedLaunch)
            .filter(
              (value): value is string =>
                typeof value === "string" && /^0x[0-9a-f]{40}$/iu.test(value),
            )
            .map(getAddress)
        : []),
      ...(manifest.stockQuoteAssets
        ? [
            manifest.stockQuoteAssets.adapterRegistry,
            manifest.stockQuoteAssets.assetRegistry,
            manifest.stockQuoteAssets.oracleGuard,
            manifest.stockQuoteAssets.destinationRegistry,
          ].map(getAddress)
        : []),
      ...(await repository.dbcLaunchContractAddresses()),
    ]);
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
          chunkSize,
          confirmations,
          maximumBlocks: settings.INDEXER_CATCHUP_MAX_BLOCKS,
          rangeDelayMs:
            settings.INDEXER_RPC_RANGE_DELAY_MS ??
            (descriptor.family === "hyperevm" ? 500 : 0),
          onDiscoveredLaunchContracts: (contracts) =>
            repository.trackDbcContracts(contracts),
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
          confirmations,
        ),
      }),
    );
  } finally {
    await repository.close();
    await sql.end();
  }
}
main().catch((error) => {
  const databaseError = error as {
    code?: unknown;
    constraint_name?: unknown;
    table_name?: unknown;
    column_name?: unknown;
  };
  const diagnosticMessage =
    error instanceof Error
      ? error.message
          .replace(/postgres(?:ql)?:\/\/[^\s]+/giu, "[database-url-redacted]")
          .replace(/https?:\/\/[^\s]+/giu, "[url-redacted]")
          .slice(0, 500)
      : null;
  console.error(
    JSON.stringify({
      service: "fast-catchup",
      status: "failed",
      code:
        error instanceof Error && /^[A-Z_]{4,80}$/u.test(error.message)
          ? error.message
          : "CATCHUP_FAILED",
      databaseCode:
        typeof databaseError?.code === "string" ? databaseError.code : null,
      constraint:
        typeof databaseError?.constraint_name === "string"
          ? databaseError.constraint_name
          : null,
      table:
        typeof databaseError?.table_name === "string"
          ? databaseError.table_name
          : null,
      column:
        typeof databaseError?.column_name === "string"
          ? databaseError.column_name
          : null,
      errorName: error instanceof Error ? error.name : null,
      diagnosticMessage,
    }),
  );
  process.exitCode = 1;
});
