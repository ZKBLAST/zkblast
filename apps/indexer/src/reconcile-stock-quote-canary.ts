import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadServerConfig } from "@zkblast/config";
import { loadDeploymentManifestFile } from "@zkblast/config/node";
import { createPublicClient, getAddress, http, type Hex } from "viem";
import { z } from "zod";

import { PostgresIndexerRepository } from "./postgres-indexer-repository.js";
import { ViemChainReader } from "./viem-chain-reader.js";

const runtime = z
  .object({
    SUPABASE_DIRECT_DATABASE_URL: z.string().url(),
    INDEXER_RPC_URL: z.string().url(),
  })
  .parse(process.env);
const config = loadServerConfig(process.env);
if (config.APP_ENV !== "mainnet" || config.CHAIN_ID !== 4663) {
  throw new Error("STOCK_QUOTE_MAINNET_ONLY");
}
const root = fileURLToPath(new URL("../../../", import.meta.url));
const manifest = await loadDeploymentManifestFile(
  resolve(root, config.DEPLOYMENT_MANIFEST_PATH),
  { environment: config.APP_ENV, chainId: config.CHAIN_ID },
);
if (!manifest.dbc) throw new Error("DBC_NOT_DEPLOYED");
const journal = JSON.parse(
  await readFile(
    resolve(
      root,
      "deployments/mainnet/stock-quotes/protected-guard-upgrade-execution.private.json",
    ),
    "utf8",
  ),
) as { receipts: Array<{ label: string; transactionHash: Hex }> };
const templateHash = journal.receipts.find(
  ({ label }) => label === "safe-create-msft-canary-template",
)?.transactionHash;
if (!templateHash) throw new Error("TEMPLATE_RECEIPT_MISSING");

const addresses = [manifest.dbc.configRegistry].map(getAddress);
const client = createPublicClient({
  cacheTime: 0,
  transport: http(runtime.INDEXER_RPC_URL, { timeout: 30_000, retryCount: 2 }),
});
const receipt = await client.getTransactionReceipt({ hash: templateHash });
if (receipt.status !== "success") throw new Error("TEMPLATE_TRANSACTION_REVERTED");
const reader = new ViemChainReader(client, config.CHAIN_ID, addresses);
const repository = new PostgresIndexerRepository(
  runtime.SUPABASE_DIRECT_DATABASE_URL,
  config.SUPABASE_SCHEMA,
  "protocol",
  addresses,
);
try {
  const block = await reader.block(receipt.blockNumber, receipt.logs);
  const persistedEvents = await repository.backfillDbcEvents(block.events);
  console.log(
    JSON.stringify({
      environment: config.APP_ENV,
      chainId: config.CHAIN_ID,
      schema: config.SUPABASE_SCHEMA,
      transactionHash: templateHash,
      blockNumber: receipt.blockNumber.toString(),
      persistedEvents,
    }),
  );
} finally {
  await repository.close();
}
