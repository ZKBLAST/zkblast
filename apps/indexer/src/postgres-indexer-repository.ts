import postgres from "postgres";
import { getAddress, type Address, type PublicClient } from "viem";
import type { BlockEnvelope, IndexerCheckpoint } from "./domain.js";
import type { IndexerRepository } from "./repository.js";
import { validateBlockForPersistence } from "./validation.js";
import { transactionObservation } from "./transaction-reconciliation.js";
import { persistPoolSwap } from "./persist-pool-swap.js";
import { installCheckpointGuard } from "./checkpoint-guard.js";
import { reconcileUserActivity } from "./reconcile-user-activity.js";
import { syncRegisteredPoolRecords } from "./sync-registered-pool-records.js";

const schemaPattern = /^zkblast_(testnet|mainnet)$/u;

export class PostgresIndexerRepository implements IndexerRepository {
  private readonly sql;
  private readonly schema: string;

  constructor(
    databaseUrl: string,
    schema: string,
    private readonly consumer = "protocol",
  ) {
    if (!schemaPattern.test(schema)) throw new Error("INVALID_DATABASE_SCHEMA");
    if (!/^(protocol|shielded-v2-[a-f0-9]{40})$/u.test(consumer))
      throw new Error("INVALID_INDEXER_CONSUMER");
    this.schema = schema;
    this.sql = postgres(databaseUrl, {
      max: 1,
      prepare: false,
      idle_timeout: 10,
    });
  }

  async checkpoint(chainId: number): Promise<IndexerCheckpoint | null> {
    const rows = await this.sql.unsafe(
      `select last_processed_block, last_processed_hash, finalized_block from ${this.schema}.ingestion_checkpoints where consumer = $2 and chain_id = $1`,
      [chainId, this.consumer],
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

  async registeredPoolAddresses(chainId: number) {
    const rows = await this.sql.unsafe<{ address: string }[]>(
      `select address from ${this.schema}.pools where chain_id=$1 and status <> 'retired'`,
      [chainId],
    );
    return rows.map((row) => getAddress(row.address));
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
    const validatedBlock = validateBlockForPersistence(
      block,
      checkpoint.chainId,
    );
    if (validatedBlock.number !== checkpoint.blockNumber)
      throw new Error("CHECKPOINT_BLOCK_MISMATCH");
    if (
      validatedBlock.hash.toLowerCase() !== checkpoint.blockHash.toLowerCase()
    )
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
      for (const event of validatedBlock.events) {
        await transaction.unsafe(
          `insert into ${this.schema}.protocol_events (chain_id,transaction_hash,log_index,block_number,block_hash,contract_address,event_kind,event_name,payload) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::text::jsonb) on conflict (chain_id,transaction_hash,log_index) do update set block_number=excluded.block_number,block_hash=excluded.block_hash,contract_address=excluded.contract_address,event_kind=excluded.event_kind,event_name=excluded.event_name,payload=excluded.payload,canonical=true`,
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
        const observation = transactionObservation(event);
        await persistPoolSwap(transaction, this.schema, event);
        if (observation)
          await transaction.unsafe(
            `insert into ${this.schema}.transactions
              (chain_id,transaction_hash,status,block_number,gas_used,effective_gas_price_wei)
             values ($1,$2,$3,$4,$5,$6)
             on conflict (chain_id,transaction_hash) do update set
               status=excluded.status,block_number=excluded.block_number,
               gas_used=excluded.gas_used,
               effective_gas_price_wei=excluded.effective_gas_price_wei,
               updated_at=now()`,
            [
              observation.chainId,
              observation.transactionHash,
              observation.status,
              observation.blockNumber.toString(),
              observation.gasUsed,
              observation.effectiveGasPriceWei,
            ],
          );
      }
      await transaction.unsafe(
        `insert into ${this.schema}.ingestion_checkpoints (consumer,chain_id,last_processed_block,last_processed_hash,finalized_block) values ($5,$1,$2,$3,$4) on conflict (consumer,chain_id) do update set last_processed_block=excluded.last_processed_block,last_processed_hash=excluded.last_processed_hash,finalized_block=excluded.finalized_block,updated_at=now()`,
        [
          checkpoint.chainId,
          checkpoint.blockNumber.toString(),
          checkpoint.blockHash.toLowerCase(),
          checkpoint.finalizedBlock.toString(),
          this.consumer,
        ],
      );
    });
  }

  async rewind(chainId: number, fromBlock: bigint): Promise<void> {
    if (this.consumer !== "protocol")
      throw new Error("ISOLATED_CONSUMER_REORG_REQUIRES_REVIEW");
    await this.sql.begin(async (transaction) => {
      await transaction.unsafe(
        "select set_config('zkblast.allow_checkpoint_rewind','on',true)",
      );
      await transaction.unsafe(
        `update ${this.schema}.swaps set canonical=false where chain_id=$1 and block_number >= $2`,
        [chainId, fromBlock.toString()],
      );
      await transaction.unsafe(
        `update ${this.schema}.trade_history set status='submitted',confirmed_at=null,error_code='CHAIN_REORG'
        where chain_id=$1 and block_number >= $2 and status='confirmed'`,
        [chainId, fromBlock.toString()],
      );
      await transaction.unsafe(
        `delete from ${this.schema}.transactions
         where chain_id=$1 and block_number >= $2
           and user_id is null and wallet_id is null and client_request_id is null`,
        [chainId, fromBlock.toString()],
      );
      await transaction.unsafe(
        `update ${this.schema}.transactions
         set status='submitted',block_number=null,gas_used=null,
             effective_gas_price_wei=null,updated_at=now()
         where chain_id=$1 and block_number >= $2`,
        [chainId, fromBlock.toString()],
      );
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

  close() {
    return this.sql.end();
  }

  enableCheckpointGuard() {
    return installCheckpointGuard(this.sql, this.schema);
  }

  reconcilePools(
    client: PublicClient,
    chainId: number,
    factory: Address,
    registry: Address,
  ) {
    return syncRegisteredPoolRecords({
      client,
      sql: this.sql,
      schema: this.schema,
      chainId,
      factory,
      registry,
    });
  }

  reconcileActivity(
    client: PublicClient,
    chainId: number,
    positionManager: Address,
    confirmations = 5n,
  ) {
    return reconcileUserActivity({
      client,
      sql: this.sql,
      schema: this.schema,
      chainId,
      positionManager,
      confirmations,
    });
  }

  async previousCanonicalBlock(
    chainId: number,
    before: bigint,
  ): Promise<bigint | null> {
    const rows = await this.sql.unsafe<{ block_number: string }[]>(
      `select block_number::text from ${this.schema}.indexed_blocks where chain_id=$1 and block_number<$2 order by block_number desc limit 1`,
      [chainId, before.toString()],
    );
    return rows[0] ? BigInt(rows[0].block_number) : null;
  }
}
