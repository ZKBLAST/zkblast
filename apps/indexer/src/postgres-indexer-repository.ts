import postgres from "postgres";
import type { BlockEnvelope, IndexerCheckpoint } from "./domain.js";
import type { IndexerRepository } from "./repository.js";
import { validateBlockForPersistence } from "./validation.js";

const schemaPattern = /^zkblast_(testnet|mainnet)$/u;

export class PostgresIndexerRepository implements IndexerRepository {
  private readonly sql;
  private readonly schema: string;

  constructor(databaseUrl: string, schema: string) {
    if (!schemaPattern.test(schema)) throw new Error("INVALID_DATABASE_SCHEMA");
    this.schema = schema;
    this.sql = postgres(databaseUrl, { max: 4, prepare: true });
  }

  async checkpoint(chainId: number): Promise<IndexerCheckpoint | null> {
    const rows = await this.sql.unsafe(
      `select last_processed_block, last_processed_hash, finalized_block from ${this.schema}.ingestion_checkpoints where consumer = 'protocol' and chain_id = $1`,
      [chainId],
    );
    const row = rows[0] as
      | {
          last_processed_block: string;
          last_processed_hash: `0x${string}`;
          finalized_block: string;
        }
      | undefined;
    return row
      ? {
          chainId,
          blockNumber: BigInt(row.last_processed_block),
          blockHash: row.last_processed_hash,
          finalizedBlock: BigInt(row.finalized_block),
        }
      : null;
  }

  async canonicalHash(
    chainId: number,
    blockNumber: bigint,
  ): Promise<string | null> {
    const rows = await this.sql.unsafe(
      `select block_hash from ${this.schema}.indexed_blocks where chain_id = $1 and block_number = $2`,
      [chainId, blockNumber.toString()],
    );
    return (rows[0] as { block_hash: string } | undefined)?.block_hash ?? null;
  }

  async applyBlock(
    block: BlockEnvelope,
    checkpoint: IndexerCheckpoint,
  ): Promise<void> {
    const validatedBlock = validateBlockForPersistence(block, checkpoint.chainId);
    if (validatedBlock.number !== checkpoint.blockNumber)
      throw new Error("CHECKPOINT_BLOCK_MISMATCH");
    if (validatedBlock.hash.toLowerCase() !== checkpoint.blockHash.toLowerCase())
      throw new Error("CHECKPOINT_HASH_MISMATCH");
    await this.sql.begin(async (transaction) => {
      await transaction.unsafe(
        `insert into ${this.schema}.indexed_blocks (chain_id, block_number, block_hash, parent_hash) values ($1,$2,$3,$4) on conflict (chain_id, block_number) do update set block_hash=excluded.block_hash,parent_hash=excluded.parent_hash`,
        [
          checkpoint.chainId,
          validatedBlock.number.toString(),
          validatedBlock.hash.toLowerCase(),
          validatedBlock.parentHash.toLowerCase(),
        ],
      );
      for (const event of validatedBlock.events)
        await transaction.unsafe(
          `insert into ${this.schema}.protocol_events (chain_id,transaction_hash,log_index,block_number,block_hash,contract_address,event_kind,event_name,payload) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) on conflict (chain_id,transaction_hash,log_index) do update set block_number=excluded.block_number,block_hash=excluded.block_hash,contract_address=excluded.contract_address,event_kind=excluded.event_kind,event_name=excluded.event_name,payload=excluded.payload,canonical=true`,
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
      await transaction.unsafe(
        `insert into ${this.schema}.ingestion_checkpoints (consumer,chain_id,last_processed_block,last_processed_hash,finalized_block) values ('protocol',$1,$2,$3,$4) on conflict (consumer,chain_id) do update set last_processed_block=excluded.last_processed_block,last_processed_hash=excluded.last_processed_hash,finalized_block=excluded.finalized_block,updated_at=now()`,
        [
          checkpoint.chainId,
          checkpoint.blockNumber.toString(),
          checkpoint.blockHash.toLowerCase(),
          checkpoint.finalizedBlock.toString(),
        ],
      );
    });
  }

  async rewind(chainId: number, fromBlock: bigint): Promise<void> {
    await this.sql.begin(async (transaction) => {
      await transaction.unsafe(
        `delete from ${this.schema}.protocol_events where chain_id=$1 and block_number >= $2`,
        [chainId, fromBlock.toString()],
      );
      await transaction.unsafe(
        `delete from ${this.schema}.indexed_blocks where chain_id=$1 and block_number >= $2`,
        [chainId, fromBlock.toString()],
      );
      const rows = await transaction.unsafe(
        `select block_number,block_hash from ${this.schema}.indexed_blocks where chain_id=$1 order by block_number desc limit 1`,
        [chainId],
      );
      const ancestor = rows[0] as
        { block_number: string; block_hash: string } | undefined;
      if (ancestor)
        await transaction.unsafe(
          `update ${this.schema}.ingestion_checkpoints set last_processed_block=$2,last_processed_hash=$3,finalized_block=least(finalized_block,$2),updated_at=now() where consumer='protocol' and chain_id=$1`,
          [chainId, ancestor.block_number, ancestor.block_hash],
        );
      else
        await transaction.unsafe(
          `delete from ${this.schema}.ingestion_checkpoints where consumer='protocol' and chain_id=$1`,
          [chainId],
        );
    });
  }
}
