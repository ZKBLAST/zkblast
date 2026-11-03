import postgres from "postgres";
import { isSupportedDatabaseSchema } from "@zkblast/config";

export type LaunchpadPage = Readonly<{ limit: number; cursor?: string }>;

export class PostgresLaunchpadReadStore {
  readonly #sql;
  constructor(databaseUrl: string, readonly schema: string, readonly chainId: number) {
    if (!isSupportedDatabaseSchema(schema)) throw new Error("INVALID_DATABASE_SCHEMA");
    this.#sql = postgres(databaseUrl, { max: 2, prepare: false, idle_timeout: 10 });
  }

  async freshness() {
    const rows = await this.#sql.unsafe<{ indexed_block: string; finalized_block: string; updated_at: Date }[]>(
      `select last_processed_block::text indexed_block,finalized_block::text,updated_at
       from ${this.schema}.ingestion_checkpoints where chain_id=$1 and consumer='protocol' order by updated_at desc limit 1`,
      [this.chainId],
    );
    const row = rows[0];
    return row ? {
      indexedBlock: row.indexed_block,
      finalizedBlock: row.finalized_block,
      lagBlocks: (BigInt(row.finalized_block) > BigInt(row.indexed_block)
        ? BigInt(row.finalized_block) - BigInt(row.indexed_block) : 0n).toString(),
      indexedAt: row.updated_at.toISOString(),
    } : null;
  }

  list(page: LaunchpadPage) {
    const [block = "9223372036854775807", id = "99999999999999999999999999999999999999"] = page.cursor?.split(":") ?? [];
    return this.#sql.unsafe<Record<string, unknown>[]>(
      `select launchpad_id::text,owner_address,treasury_address,operator_address,metadata_hash,slug_commitment,
       config_preset_id::text,version,status,created_block::text,updated_block::text,transaction_hash
       from ${this.schema}.launchpads where chain_id=$1 and (updated_block,launchpad_id) < ($2::bigint,$3::numeric)
       order by updated_block desc,launchpad_id desc limit $4`,
      [this.chainId,block,id,page.limit + 1],
    );
  }

  async detail(launchpadId: string) {
    const rows = await this.#sql.unsafe<Record<string, unknown>[]>(
      `select launchpad_id::text,owner_address,pending_owner_address,treasury_address,pending_treasury_address,
       operator_address,metadata_hash,slug_commitment,config_preset_id::text,version,status,created_block::text,
       updated_block::text,transaction_hash from ${this.schema}.launchpads where chain_id=$1 and launchpad_id=$2`,
      [this.chainId,launchpadId],
    );
    return rows[0] ?? null;
  }

  tokens(launchpadId: string, limit: number) {
    return this.#sql.unsafe<Record<string, unknown>[]>(
      `select launch_id,token_address,virtual_pool,quote_token,name,symbol,lifecycle,fee_snapshot_id,
       graduation_destination,updated_block::text from ${this.schema}.dbc_launches
       where chain_id=$1 and launchpad_bound and launchpad_id=$2 order by updated_block desc limit $3`,
      [this.chainId,launchpadId,limit],
    );
  }

  trades(launchpadId: string, limit: number) {
    return this.#sql.unsafe<Record<string, unknown>[]>(
      `select s.transaction_hash,s.log_index,s.launch_id,s.trader,s.recipient,s.is_buy,s.quote_amount_raw::text,
       s.base_amount_raw::text,s.fee_raw::text,s.price_x18::text,s.block_number::text,s.observed_at
       from ${this.schema}.dbc_swaps s join ${this.schema}.dbc_launches l on l.chain_id=s.chain_id and l.launch_id=s.launch_id
       where s.chain_id=$1 and s.canonical and l.launchpad_bound and l.launchpad_id=$2 order by s.block_number desc,s.log_index desc limit $3`,
      [this.chainId,launchpadId,limit],
    );
  }

  async fees(launchpadId: string) {
    const [policies,snapshots] = await Promise.all([
      this.#sql.unsafe<Record<string, unknown>[]>(`select * from ${this.schema}.launchpad_fee_policies where chain_id=$1 and launchpad_id=$2`,[this.chainId,launchpadId]),
      this.#sql.unsafe<Record<string, unknown>[]>(`select snapshot_id,pool_address,asset_address,policy_version,transaction_hash,updated_block::text from ${this.schema}.launchpad_fee_snapshots where chain_id=$1 and launchpad_id=$2 order by updated_block desc limit 100`,[this.chainId,launchpadId]),
    ]);
    return { policy: policies[0] ?? null, snapshots };
  }

  graduations(launchpadId: string, limit: number) {
    return this.#sql.unsafe<Record<string, unknown>[]>(
      `select g.migration_id,g.launch_id,g.source_pool,g.adapter,g.status,g.attempts,g.failure_hash,
       g.graduation_destination,g.transaction_hash,g.updated_block::text,g.updated_at
       from ${this.schema}.dbc_graduation_attempts g where g.chain_id=$1 and g.launchpad_id=$2 order by g.updated_block desc limit $3`,
      [this.chainId,launchpadId,limit],
    );
  }

  async boundPool(launchpadId: string, pool: string) {
    const rows = await this.#sql.unsafe<{ virtual_pool: string; template_id: string; lifecycle: number }[]>(
      `select virtual_pool,template_id::text,lifecycle from ${this.schema}.dbc_launches
       where chain_id=$1 and launchpad_bound and launchpad_id=$2 and virtual_pool=$3 limit 1`,
      [this.chainId,launchpadId,pool.toLowerCase()],
    );
    return rows[0] ?? null;
  }

  async health() {
    const rows = await this.#sql.unsafe<{
      launchpads: string; bound_launches: string; failed_graduations: string;
      pending_retries: string; missing_launchpad_bindings: string; incomplete_fee_snapshots: string;
      webhook_pending: string; webhook_dead_letters: string; domains_pending: string; domains_expired: string;
    }[]>(
      `select
       (select count(*)::text from ${this.schema}.launchpads where chain_id=$1) launchpads,
       (select count(*)::text from ${this.schema}.dbc_launches where chain_id=$1 and launchpad_bound) bound_launches,
       (select count(*)::text from ${this.schema}.dbc_graduation_attempts where chain_id=$1 and status='FAILED_NEEDS_REVIEW') failed_graduations,
       (select count(*)::text from ${this.schema}.dbc_graduation_attempts where chain_id=$1 and status='PENDING_RETRY') pending_retries,
       (select count(*)::text from ${this.schema}.dbc_launches d left join ${this.schema}.launchpads l on l.chain_id=d.chain_id and l.launchpad_id=d.launchpad_id
         where d.chain_id=$1 and d.launchpad_bound and l.launchpad_id is null) missing_launchpad_bindings,
       (select count(*)::text from ${this.schema}.launchpad_fee_snapshots where chain_id=$1 and asset_address is null) incomplete_fee_snapshots,
       (select count(*)::text from ${this.schema}.launchpad_webhook_outbox where chain_id=$1 and status in ('pending','processing','failed')) webhook_pending,
       (select count(*)::text from ${this.schema}.launchpad_webhook_outbox where chain_id=$1 and status='dead_letter') webhook_dead_letters,
       (select count(*)::text from ${this.schema}.launchpad_domains where chain_id=$1 and status='pending') domains_pending,
       (select count(*)::text from ${this.schema}.launchpad_domains where chain_id=$1 and status='expired') domains_expired`,
      [this.chainId],
    );
    return rows[0]!;
  }

  events(afterBlock: string,afterLogIndex: number,limit: number) {
    return this.#sql.unsafe<Record<string,unknown>[]>(
      `select chain_id,transaction_hash,log_index,block_number::text,block_hash,contract_address,event_name,payload,observed_at
       from ${this.schema}.dbc_events where chain_id=$1 and canonical
       and event_name=any($2::text[]) and (block_number,log_index) > ($3::bigint,$4)
       order by block_number,log_index limit $5`,
      [this.chainId,["LaunchpadCreated","LaunchpadMetadataUpdated","LaunchpadOperatorUpdated","LaunchpadOwnerAccepted","LaunchpadTreasuryAccepted","LaunchpadStatusUpdated","LaunchpadFeePolicyUpdated","FeePolicySnapshotted","RevenueSnapshotRegistered","LaunchpadTokenBound","ProofClaimVerified"],afterBlock,afterLogIndex,limit],
    );
  }
}
