import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadServerConfig, parseDeploymentManifest } from "@zkblast/config";
import postgres from "postgres";
import { createPublicClient, getAddress, http } from "viem";
import { ViemChainReader } from "./viem-chain-reader.js";
import { validateBlockForPersistence } from "./validation.js";

if (process.env.APP_ENV !== "testnet")
  throw new Error("Testnet environment required");
const config = loadServerConfig(process.env);
const databaseUrl = process.env.SUPABASE_DIRECT_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("SUPABASE_DIRECT_DATABASE_URL is required");
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const manifest = parseDeploymentManifest(
  JSON.parse(
    await readFile(path.resolve(root, config.DEPLOYMENT_MANIFEST_PATH), "utf8"),
  ),
  { environment: "testnet", chainId: config.CHAIN_ID },
);
if (!manifest.shielded) throw new Error("Shielded deployment is missing");
const deployment = JSON.parse(
  await readFile(
    path.resolve(root, "deployments/testnet/shielded-vault.json"),
    "utf8",
  ),
) as { transactions: Record<string, { blockNumber: number }> };
const reader = new ViemChainReader(
  createPublicClient({ transport: http(config.RPC_URL) }),
  config.CHAIN_ID,
  [manifest.shielded.vault, manifest.shielded.stateRegistry].map(getAddress),
);
const blocks = [
  ...new Set(
    Object.values(deployment.transactions).map(
      ({ blockNumber }) => blockNumber,
    ),
  ),
].sort((left, right) => left - right);
const sql = postgres(databaseUrl, { max: 1, prepare: true });

try {
  let eventCount = 0;
  for (const number of blocks) {
    const block = validateBlockForPersistence(
      await reader.block(BigInt(number)),
      config.CHAIN_ID,
    );
    await sql.begin(async (transaction) => {
      await transaction.unsafe(
        `insert into ${config.SUPABASE_SCHEMA}.indexed_blocks (chain_id,block_number,block_hash,parent_hash) values ($1,$2,$3,$4) on conflict (chain_id,block_number) do update set block_hash=excluded.block_hash,parent_hash=excluded.parent_hash`,
        [
          config.CHAIN_ID,
          block.number.toString(),
          block.hash.toLowerCase(),
          block.parentHash.toLowerCase(),
        ],
      );
      for (const event of block.events) {
        await transaction.unsafe(
          `insert into ${config.SUPABASE_SCHEMA}.protocol_events (chain_id,transaction_hash,log_index,block_number,block_hash,contract_address,event_kind,event_name,payload) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) on conflict (chain_id,transaction_hash,log_index) do update set block_number=excluded.block_number,block_hash=excluded.block_hash,contract_address=excluded.contract_address,event_kind=excluded.event_kind,event_name=excluded.event_name,payload=excluded.payload,canonical=true`,
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
  const last = validateBlockForPersistence(
    await reader.block(BigInt(blocks.at(-1)!)),
    config.CHAIN_ID,
  );
  await sql.unsafe(
    `insert into ${config.SUPABASE_SCHEMA}.ingestion_checkpoints (consumer,chain_id,last_processed_block,last_processed_hash,finalized_block) values ('shielded-acceptance',$1,$2,$3,$2) on conflict (consumer,chain_id) do update set last_processed_block=excluded.last_processed_block,last_processed_hash=excluded.last_processed_hash,finalized_block=excluded.finalized_block,updated_at=now()`,
    [config.CHAIN_ID, last.number.toString(), last.hash.toLowerCase()],
  );
  console.log(
    `Backfilled ${eventCount} validated shielded events across ${blocks.length} receipt blocks`,
  );
} finally {
  await sql.end();
}
