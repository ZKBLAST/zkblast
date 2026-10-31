import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadServerConfig } from "@zkblast/config";
import { loadDeploymentManifestFile } from "@zkblast/config/node";
import { createPublicClient, getAddress, http, type Log } from "viem";
import { z } from "zod";
import { PostgresIndexerRepository } from "./postgres-indexer-repository.js";
import { ViemChainReader } from "./viem-chain-reader.js";

const runtime = z
  .object({
    SUPABASE_DIRECT_DATABASE_URL: z.string().url(),
    INDEXER_CONFIRMATIONS: z.coerce.number().int().min(1).default(5),
  })
  .parse(process.env);
const config = loadServerConfig(process.env);
const root = fileURLToPath(new URL("../../../", import.meta.url));
const manifest = await loadDeploymentManifestFile(
  resolve(root, config.DEPLOYMENT_MANIFEST_PATH),
  { environment: config.APP_ENV, chainId: config.CHAIN_ID },
);
if (!manifest.dbc) throw new Error("DBC_NOT_DEPLOYED");
const addresses = [
  manifest.dbc.configRegistry,
  manifest.dbc.launchFactory,
  manifest.dbc.curveQuoter,
  manifest.dbc.launchpadRouter,
  manifest.dbc.graduationManager,
  manifest.dbc.dammGraduationAdapter,
  manifest.dbc.lpAllocationEscrow,
].map(getAddress);
const client = createPublicClient({
  cacheTime: 0,
  transport: http(config.RPC_URL, { timeout: 20_000, retryCount: 1 }),
});
const repository = new PostgresIndexerRepository(
  runtime.SUPABASE_DIRECT_DATABASE_URL,
  config.SUPABASE_SCHEMA,
  "protocol",
  addresses,
);
const existing = await repository.dbcLaunchContractAddresses();
const reader = new ViemChainReader(client, config.CHAIN_ID, [
  ...addresses,
  ...existing,
]);
const head =
  (await client.getBlockNumber()) - BigInt(runtime.INDEXER_CONFIRMATIONS);
let events = 0,
  blocks = 0;
for (
  let from = BigInt(manifest.dbc.deploymentBlock);
  from <= head;
  from += 2_000n
) {
  const to = from + 1_999n > head ? head : from + 1_999n;
  const logs = await client.getLogs({
    address: [...addresses, ...existing],
    fromBlock: from,
    toBlock: to,
  });
  const grouped = new Map<bigint, Log[]>();
  for (const log of logs) {
    if (log.blockNumber === null) continue;
    const group = grouped.get(log.blockNumber) ?? [];
    group.push(log);
    grouped.set(log.blockNumber, group);
  }
  for (const [blockNumber, blockLogs] of [...grouped].sort(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    const block = await reader.block(blockNumber, blockLogs);
    events += await repository.backfillDbcEvents(block.events);
    blocks++;
  }
}
console.log(
  JSON.stringify(
    {
      environment: config.APP_ENV,
      chainId: config.CHAIN_ID,
      fromBlock: manifest.dbc.deploymentBlock,
      toBlock: head.toString(),
      eventBlocks: blocks,
      events,
    },
    null,
    2,
  ),
);
