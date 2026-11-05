import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadServerConfig } from "@zkblast/config";
import { loadDeploymentManifestFile } from "@zkblast/config/node";
import { createPublicClient, getAddress, type Log } from "viem";
import { z } from "zod";

import { PostgresIndexerRepository } from "./postgres-indexer-repository.js";
import { createIndexerTransport } from "./rpc-transport.js";
import { ViemChainReader } from "./viem-chain-reader.js";

const runtime = z
  .object({
    SUPABASE_DIRECT_DATABASE_URL: z.string().url(),
    INDEXER_CONFIRMATIONS: z.coerce.number().int().min(1).default(5),
    STOCK_QUOTE_BACKFILL_FROM_BLOCK: z.coerce.bigint().min(0n).optional(),
    STOCK_QUOTE_BACKFILL_TO_BLOCK: z.coerce.bigint().min(0n).optional(),
  })
  .parse(process.env);
const config = loadServerConfig(process.env);
const root = fileURLToPath(new URL("../../../", import.meta.url));
const manifest = await loadDeploymentManifestFile(
  resolve(root, config.DEPLOYMENT_MANIFEST_PATH),
  { environment: config.APP_ENV, chainId: config.CHAIN_ID },
);
if (!manifest.stockQuoteAssets) throw new Error("STOCK_QUOTE_ASSETS_NOT_DEPLOYED");
const addresses = [
  manifest.stockQuoteAssets.adapterRegistry,
  manifest.stockQuoteAssets.assetRegistry,
  manifest.stockQuoteAssets.oracleGuard,
  manifest.stockQuoteAssets.destinationRegistry,
].map(getAddress);
const client = createPublicClient({
  cacheTime: 0,
  transport: createIndexerTransport(config.RPC_URL),
});
const confirmedHead =
  (await client.getBlockNumber()) - BigInt(runtime.INDEXER_CONFIRMATIONS);
const fromBlock =
  runtime.STOCK_QUOTE_BACKFILL_FROM_BLOCK ??
  BigInt(manifest.stockQuoteAssets.deploymentBlock);
const toBlock = runtime.STOCK_QUOTE_BACKFILL_TO_BLOCK ?? confirmedHead;
if (toBlock < fromBlock) throw new Error("INVALID_STOCK_QUOTE_BACKFILL_RANGE");
const repository = new PostgresIndexerRepository(
  runtime.SUPABASE_DIRECT_DATABASE_URL,
  config.SUPABASE_SCHEMA,
  "protocol",
  addresses,
);
const reader = new ViemChainReader(client, config.CHAIN_ID, addresses);
let eventBlocks = 0;
let persistedEvents = 0;
try {
  for (let from = fromBlock; from <= toBlock; from += 2_000n) {
    const to = from + 1_999n > toBlock ? toBlock : from + 1_999n;
    const logs = await client.getLogs({ address: addresses, fromBlock: from, toBlock: to });
    const grouped = new Map<bigint, Log[]>();
    for (const log of logs) {
      if (log.blockNumber === null) continue;
      const blockLogs = grouped.get(log.blockNumber) ?? [];
      blockLogs.push(log);
      grouped.set(log.blockNumber, blockLogs);
    }
    for (const [blockNumber, blockLogs] of [...grouped].sort(([a], [b]) =>
      a < b ? -1 : 1,
    )) {
      const block = await reader.block(blockNumber, blockLogs);
      persistedEvents += await repository.backfillStockQuoteEvents(block.events);
      eventBlocks++;
    }
  }
  console.log(
    JSON.stringify(
      {
        environment: config.APP_ENV,
        chainId: config.CHAIN_ID,
        schema: config.SUPABASE_SCHEMA,
        fromBlock: fromBlock.toString(),
        toBlock: toBlock.toString(),
        eventBlocks,
        persistedEvents,
        addresses,
      },
      null,
      2,
    ),
  );
} finally {
  await repository.close();
}
