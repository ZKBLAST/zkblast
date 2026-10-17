import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadServerConfig, parseDeploymentManifest } from "@zkblast/config";
import postgres from "postgres";
import { createPublicClient, getAddress, http } from "viem";
import { ViemChainReader } from "./viem-chain-reader.js";

if (process.env.APP_ENV !== "testnet")
  throw new Error("Testnet environment required");
const config = loadServerConfig(process.env);
const databaseUrl = process.env.SUPABASE_DIRECT_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("SUPABASE_DIRECT_DATABASE_URL is required");
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const protocol = parseDeploymentManifest(
  JSON.parse(
    await readFile(path.resolve(root, config.DEPLOYMENT_MANIFEST_PATH), "utf8"),
  ),
  { environment: "testnet", chainId: config.CHAIN_ID },
);
const market = JSON.parse(
  await readFile(path.resolve(root, "deployments/testnet/market.json"), "utf8"),
) as {
  chainId: number;
  pool: { address: string };
  transactions: Record<string, { blockNumber: number }>;
};
if (market.chainId !== config.CHAIN_ID)
  throw new Error("Market chain mismatch");
const addresses = [
  ...Object.values(protocol.integration),
  market.pool.address,
].map(getAddress);
const client = createPublicClient({ transport: http(config.RPC_URL) });
const reader = new ViemChainReader(client, config.CHAIN_ID, addresses);
const blocks = [
  ...new Set(
    Object.values(market.transactions).map(
      (transaction) => transaction.blockNumber,
    ),
  ),
].sort((a, b) => a - b);
const sql = postgres(databaseUrl, { max: 1, prepare: true });

try {
  let eventCount = 0;
  for (const blockNumber of blocks) {
    const block = await reader.block(BigInt(blockNumber));
    await sql.begin(async (transaction) => {
      await transaction.unsafe(
        `insert into zkblast_testnet.indexed_blocks (chain_id,block_number,block_hash,parent_hash) values ($1,$2,$3,$4) on conflict (chain_id,block_number) do update set block_hash=excluded.block_hash,parent_hash=excluded.parent_hash`,
        [
          config.CHAIN_ID,
          block.number.toString(),
          block.hash.toLowerCase(),
          block.parentHash.toLowerCase(),
        ],
      );
      for (const event of block.events) {
        await transaction.unsafe(
          `insert into zkblast_testnet.protocol_events (chain_id,transaction_hash,log_index,block_number,block_hash,contract_address,event_kind,event_name,payload) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) on conflict (chain_id,transaction_hash,log_index) do update set block_number=excluded.block_number,block_hash=excluded.block_hash,event_kind=excluded.event_kind,event_name=excluded.event_name,payload=excluded.payload,canonical=true`,
          [
            event.chainId,
            event.transactionHash.toLowerCase(),
            event.logIndex,
            event.blockNumber.toString(),
            event.blockHash.toLowerCase(),
            event.contractAddress.toLowerCase(),
            event.kind,
            event.eventName,
            JSON.stringify(event.payload),
          ],
        );
        eventCount += 1;
      }
    });
  }
  const lastBlock = await reader.block(BigInt(blocks.at(-1) ?? 0));
  await sql.unsafe(
    `insert into zkblast_testnet.ingestion_checkpoints (consumer,chain_id,last_processed_block,last_processed_hash,finalized_block) values ('market-acceptance',$1,$2,$3,$2) on conflict (consumer,chain_id) do update set last_processed_block=excluded.last_processed_block,last_processed_hash=excluded.last_processed_hash,finalized_block=excluded.finalized_block,updated_at=now()`,
    [
      config.CHAIN_ID,
      lastBlock.number.toString(),
      lastBlock.hash.toLowerCase(),
    ],
  );
  console.log(
    `Backfilled ${eventCount} canonical protocol/receipt events across ${blocks.length} testnet blocks`,
  );
} finally {
  await sql.end();
}
