import postgres from "postgres";
import { isSupportedDatabaseSchema } from "@zkblast/config";
import { getAddress, type Address, type PublicClient } from "viem";
import type { BlockEnvelope, IndexerCheckpoint } from "./domain.js";
import type { IndexerRepository } from "./repository.js";
import { validateBlockForPersistence } from "./validation.js";
import { transactionObservation } from "./transaction-reconciliation.js";
import { persistPoolSwap } from "./persist-pool-swap.js";
import { installCheckpointGuard } from "./checkpoint-guard.js";
import { reconcileUserActivity } from "./reconcile-user-activity.js";
import { syncRegisteredPoolRecords } from "./sync-registered-pool-records.js";
import { persistPerpsEvent } from "./persist-perps-event.js";
import { persistDbcEvent } from "./persist-dbc-event.js";
import type { IndexedEvent } from "./domain.js";
import { persistAssistanceFundEvent } from "./persist-assistance-fund-event.js";

const launchpadProjectionEvents = [
  "LaunchpadCreated",
  "LaunchpadMetadataUpdated",
  "LaunchpadOperatorUpdated",
  "LaunchpadOwnerProposed",
  "LaunchpadOwnerProposalCancelled",
  "LaunchpadOwnerAccepted",
  "LaunchpadTreasuryProposed",
  "LaunchpadTreasuryProposalCancelled",
  "LaunchpadTreasuryAccepted",
  "LaunchpadStatusUpdated",
  "LaunchpadFeePolicyUpdated",
  "FeePolicySnapshotted",
  "RevenueSnapshotRegistered",
  "ProofClaimVerified",
  "ProtectionPolicyCreated",
  "ProtectionPolicyStatusUpdated",
  "ProtectionPolicyUsed",
  "ProtectedTokenLaunched",
  "ProtectedPurchaseRecorded",
  "ProtectedAllocationRegistered",
  "ProtectedAllocationClaimed",
  "ProtectedLaunchIdentityRegistered",
  "ProtectedLaunchIdentityBoundToLaunchpad",
  "GraduationAttemptStarted",
  "GraduationAttemptPending",
  "GraduationNeedsReview",
  "GraduationCompleted",
] as const;

export const isIndexerConsumer = (consumer: string): boolean =>
  /^(protocol|shielded-v2-[a-f0-9]{40}|assistance-fund(?:-v\d+)?-[a-f0-9]{40})$/u.test(
    consumer,
  );

export class PostgresIndexerRepository implements IndexerRepository {
  private readonly sql;
  private readonly schema: string;

  constructor(
    databaseUrl: string,
    schema: string,
    private readonly consumer = "protocol",
    dbcContracts: readonly Address[] = [],
  ) {
    if (!isSupportedDatabaseSchema(schema))
      throw new Error("INVALID_DATABASE_SCHEMA");
    if (!isIndexerConsumer(consumer))
      throw new Error("INVALID_INDEXER_CONSUMER");
    this.schema = schema;
    this.dbcContracts = new Set(
      dbcContracts.map((address) => address.toLowerCase()),
    );
    this.sql = postgres(databaseUrl, {
      max: 1,
      prepare: false,
      idle_timeout: 10,
    });
  }

  private readonly dbcContracts: Set<string>;

  trackDbcContracts(addresses: readonly Address[]): void {
    for (const address of addresses) {
      this.dbcContracts.add(getAddress(address).toLowerCase());
    }
  }

  async dbcLaunchContractAddresses(): Promise<Address[]> {
    const rows = await this.sql.unsafe<
      { token_address: string; virtual_pool: string }[]
    >(
      `select token_address, virtual_pool from ${this.schema}.dbc_launches
       union
       select token_address, pool_address as virtual_pool
       from ${this.schema}.protected_launches where canonical`,
    );
    return rows
      .flatMap((row) => [row.token_address, row.virtual_pool])
      .map(getAddress)
      .filter((address, index, all) => all.indexOf(address) === index);
  }

  async backfillDbcEvents(events: BlockEnvelope["events"]): Promise<number> {
    const blockDbcContracts = new Set(this.dbcContracts);
    const projectionEvents = [...events].sort((left, right) => {
      const priority = (eventName: string) =>
        eventName === "TokenLaunched" || eventName === "ProtectedTokenLaunched"
          ? -1
          : eventName === "AllocationRegistered"
            ? 1
            : 0;
      return priority(left.eventName) - priority(right.eventName);
    });
    await this.sql.begin(async (transaction) => {
      for (const event of projectionEvents) {
        await persistDbcEvent(
          transaction,
          this.schema,
          event,
          blockDbcContracts,
        );
        if (
          (event.eventName === "TokenLaunched" ||
            event.eventName === "ProtectedTokenLaunched") &&
          typeof event.payload.token === "string"
        ) {
          blockDbcContracts.add(getAddress(event.payload.token).toLowerCase());
          if (typeof event.payload.virtualPool === "string") {
            blockDbcContracts.add(
              getAddress(event.payload.virtualPool).toLowerCase(),
            );
          }
        }
      }
    });
    for (const contract of blockDbcContracts) this.dbcContracts.add(contract);
    return events.length;
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
    const blockDbcContracts = new Set(this.dbcContracts);
    await this.sql.begin(async (transaction) => {
      const deferredDbcEvents: Array<(typeof validatedBlock.events)[number]> =
        [];
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
        await persistPerpsEvent(transaction, this.schema, event);
        await persistAssistanceFundEvent(transaction, this.schema, event);
        if (event.eventName === "AllocationRegistered")
          deferredDbcEvents.push(event);
        else
          await persistDbcEvent(
            transaction,
            this.schema,
            event,
            blockDbcContracts,
          );
        if (
          event.eventName === "TokenLaunched" &&
          typeof event.payload.token === "string"
        ) {
          blockDbcContracts.add(getAddress(event.payload.token).toLowerCase());
          if (typeof event.payload.virtualPool === "string") {
            blockDbcContracts.add(
              getAddress(event.payload.virtualPool).toLowerCase(),
            );
          }
        }
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
      for (const event of deferredDbcEvents)
        await persistDbcEvent(
          transaction,
          this.schema,
          event,
          blockDbcContracts,
        );
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
    for (const contract of blockDbcContracts) this.dbcContracts.add(contract);
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
        `update ${this.schema}.perp_events set canonical=false where chain_id=$1 and block_number >= $2`,
        [chainId, fromBlock.toString()],
      );
      await transaction.unsafe(
        `update ${this.schema}.dbc_events set canonical=false where chain_id=$1 and block_number >= $2`,
        [chainId, fromBlock.toString()],
      );
      for (const table of [
        "assistance_fee_sources",
        "assistance_revenue_receipts",
        "assistance_allocations",
        "assistance_buyback_receipts",
        "assistance_burn_receipts",
        "assistance_reconciliation_snapshots",
      ])
        await transaction.unsafe(
          `delete from ${this.schema}.${table} where chain_id=$1 and block_number >= $2`,
          [chainId, fromBlock.toString()],
        );
      const launchpadEvents = await transaction.unsafe<
        {
          chain_id: number;
          transaction_hash: `0x${string}`;
          log_index: number;
          block_number: string;
          block_hash: `0x${string}`;
          contract_address: Address;
          event_name: string;
          payload: IndexedEvent["payload"];
        }[]
      >(
        `select chain_id,transaction_hash,log_index,block_number::text,block_hash,contract_address,event_name,payload
         from ${this.schema}.dbc_events where chain_id=$1 and canonical and event_name=any($2::text[])
         order by block_number,log_index`,
        [chainId, launchpadProjectionEvents],
      );
      await transaction.unsafe(
        `delete from ${this.schema}.launchpads where chain_id=$1`,
        [chainId],
      );
      for (const table of [
        "protected_launch_identities",
        "protected_buy_allocations",
        "protected_lp_allocations",
        "protected_graduation_migrations",
        "protected_invariant_alerts",
        "protected_launches",
        "protected_launch_policies",
      ])
        await transaction.unsafe(
          `delete from ${this.schema}.${table} where chain_id=$1`,
          [chainId],
        );
      const replayContracts = new Set(this.dbcContracts);
      for (const row of launchpadEvents)
        replayContracts.add(row.contract_address.toLowerCase());
      for (const row of launchpadEvents) {
        await persistDbcEvent(
          transaction,
          this.schema,
          {
            chainId: row.chain_id,
            transactionHash: row.transaction_hash,
            logIndex: row.log_index,
            blockNumber: BigInt(row.block_number),
            blockHash: row.block_hash,
            contractAddress: getAddress(row.contract_address),
            kind: "launch",
            eventName: row.event_name,
            payload: row.payload,
          },
          replayContracts,
        );
      }
      await transaction.unsafe(
        `update ${this.schema}.dbc_swaps set canonical=false where chain_id=$1 and block_number >= $2`,
        [chainId, fromBlock.toString()],
      );
      await transaction.unsafe(
        `delete from ${this.schema}.dbc_holder_balances`,
      );
      await transaction.unsafe(
        `insert into ${this.schema}.dbc_holder_balances(launch_id,account,balance_raw,updated_block)
         select l.launch_id,e.account,sum(e.delta),max(e.block_number) from (
           select contract_address,lower(payload->>'to') account,(payload->>'value')::numeric delta,block_number
           from ${this.schema}.dbc_events where canonical and event_name='Transfer' and payload->>'to' <> '0x0000000000000000000000000000000000000000'
           union all
           select contract_address,lower(payload->>'from') account,-(payload->>'value')::numeric delta,block_number
           from ${this.schema}.dbc_events where canonical and event_name='Transfer' and payload->>'from' <> '0x0000000000000000000000000000000000000000'
         ) e join ${this.schema}.dbc_launches l on l.token_address=e.contract_address
         group by l.launch_id,e.account having sum(e.delta)>=0`,
      );
      await transaction.unsafe(
        `delete from ${this.schema}.dbc_graduations where block_number >= $1`,
        [fromBlock.toString()],
      );
      for (const table of [
        "dbc_graduation_readiness",
        "dbc_graduation_adapter_bindings",
        "launchpad_fee_claim_receipts",
        "launchpad_proof_receipts",
      ])
        await transaction.unsafe(
          `delete from ${this.schema}.${table} where chain_id=$1 and block_number >= $2`,
          [chainId, fromBlock.toString()],
        );
      await transaction.unsafe(
        `update ${this.schema}.perp_oracle_prices set canonical=false where block_number >= $1`,
        [fromBlock.toString()],
      );
      await transaction.unsafe(
        `delete from ${this.schema}.perp_vault_snapshots where block_number >= $1`,
        [fromBlock.toString()],
      );
      await transaction.unsafe(
        `update ${this.schema}.perp_lp_activity set canonical=false where chain_id=$1 and block_number >= $2`,
        [chainId, fromBlock.toString()],
      );
      await transaction.unsafe(
        `update ${this.schema}.perp_insurance_activity set canonical=false where chain_id=$1 and block_number >= $2`,
        [chainId, fromBlock.toString()],
      );
      await transaction.unsafe(
        `delete from ${this.schema}.perp_positions where opened_block >= $1`,
        [fromBlock.toString()],
      );
      await transaction.unsafe(
        `update ${this.schema}.perp_positions set status='open',closed_transaction_hash=null,
         closed_block=null,closed_at=null,updated_at=now()
         where closed_block >= $1 and opened_block < $1`,
        [fromBlock.toString()],
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
