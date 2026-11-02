import postgres from "postgres";

const schemaPattern = /^zkblast_(testnet|mainnet)$/u;
export type LaunchpadPage = Readonly<{ limit: number; cursor?: string }>;

export class PostgresLaunchpadReadStore {
  readonly #sql;
  constructor(databaseUrl: string, readonly schema: string) {
    if (!schemaPattern.test(schema)) throw new Error("INVALID_DATABASE_SCHEMA");
    this.#sql = postgres(databaseUrl, { max: 2, prepare: false, idle_timeout: 10 });
  }

  async freshness() {
    const rows = await this.#sql.unsafe<{ indexed_block: string; finalized_block: string; updated_at: Date }[]>(
      `select last_processed_block::text indexed_block,finalized_block::text,updated_at
       from ${this.schema}.ingestion_checkpoints where consumer='protocol' order by updated_at desc limit 1`,
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
       from ${this.schema}.launchpads where (updated_block,launchpad_id) < ($1::bigint,$2::numeric)
       order by updated_block desc,launchpad_id desc limit $3`,
      [block,id,page.limit + 1],
    );
  }

  async detail(launchpadId: string) {
    const rows = await this.#sql.unsafe<Record<string, unknown>[]>(
      `select launchpad_id::text,owner_address,pending_owner_address,treasury_address,pending_treasury_address,
       operator_address,metadata_hash,slug_commitment,config_preset_id::text,version,status,created_block::text,
       updated_block::text,transaction_hash from ${this.schema}.launchpads where launchpad_id=$1`,
      [launchpadId],
    );
    return rows[0] ?? null;
  }

  tokens(launchpadId: string, limit: number) {
    return this.#sql.unsafe<Record<string, unknown>[]>(
      `select launch_id,token_address,virtual_pool,quote_token,name,symbol,lifecycle,fee_snapshot_id,
       graduation_destination,updated_block::text from ${this.schema}.dbc_launches
       where launchpad_bound and launchpad_id=$1 order by updated_block desc limit $2`,
      [launchpadId,limit],
    );
  }

  trades(launchpadId: string, limit: number) {
    return this.#sql.unsafe<Record<string, unknown>[]>(
      `select s.transaction_hash,s.log_index,s.launch_id,s.trader,s.recipient,s.is_buy,s.quote_amount_raw::text,
       s.base_amount_raw::text,s.fee_raw::text,s.price_x18::text,s.block_number::text,s.observed_at
       from ${this.schema}.dbc_swaps s join ${this.schema}.dbc_launches l on l.launch_id=s.launch_id
       where s.canonical and l.launchpad_bound and l.launchpad_id=$1 order by s.block_number desc,s.log_index desc limit $2`,
      [launchpadId,limit],
    );
  }

  async fees(launchpadId: string) {
    const [policies,snapshots] = await Promise.all([
      this.#sql.unsafe<Record<string, unknown>[]>(`select * from ${this.schema}.launchpad_fee_policies where launchpad_id=$1`,[launchpadId]),
      this.#sql.unsafe<Record<string, unknown>[]>(`select snapshot_id,pool_address,asset_address,policy_version,transaction_hash,updated_block::text from ${this.schema}.launchpad_fee_snapshots where launchpad_id=$1 order by updated_block desc limit 100`,[launchpadId]),
    ]);
    return { policy: policies[0] ?? null, snapshots };
  }

  graduations(launchpadId: string, limit: number) {
    return this.#sql.unsafe<Record<string, unknown>[]>(
      `select g.migration_id,g.launch_id,g.source_pool,g.adapter,g.status,g.attempts,g.failure_hash,
       g.graduation_destination,g.transaction_hash,g.updated_block::text,g.updated_at
       from ${this.schema}.dbc_graduation_attempts g where g.launchpad_id=$1 order by g.updated_block desc limit $2`,
      [launchpadId,limit],
    );
  }

  async boundPool(launchpadId: string, pool: string) {
    const rows = await this.#sql.unsafe<{ virtual_pool: string; template_id: string; lifecycle: number }[]>(
      `select virtual_pool,template_id::text,lifecycle from ${this.schema}.dbc_launches
       where launchpad_bound and launchpad_id=$1 and virtual_pool=$2 limit 1`,
      [launchpadId,pool.toLowerCase()],
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
       (select count(*)::text from ${this.schema}.launchpads) launchpads,
       (select count(*)::text from ${this.schema}.dbc_launches where launchpad_bound) bound_launches,
       (select count(*)::text from ${this.schema}.dbc_graduation_attempts where status='FAILED_NEEDS_REVIEW') failed_graduations,
       (select count(*)::text from ${this.schema}.dbc_graduation_attempts where status='PENDING_RETRY') pending_retries,
       (select count(*)::text from ${this.schema}.dbc_launches d left join ${this.schema}.launchpads l on l.launchpad_id=d.launchpad_id
         where d.launchpad_bound and l.launchpad_id is null) missing_launchpad_bindings,
       (select count(*)::text from ${this.schema}.launchpad_fee_snapshots where asset_address is null) incomplete_fee_snapshots,
       (select count(*)::text from ${this.schema}.launchpad_webhook_outbox where status in ('pending','processing','failed')) webhook_pending,
       (select count(*)::text from ${this.schema}.launchpad_webhook_outbox where status='dead_letter') webhook_dead_letters,
       (select count(*)::text from ${this.schema}.launchpad_domains where status='pending') domains_pending,
       (select count(*)::text from ${this.schema}.launchpad_domains where status='expired') domains_expired`,
    );
    return rows[0]!;
  }

  events(afterBlock: string,afterLogIndex: number,limit: number) {
    return this.#sql.unsafe<Record<string,unknown>[]>(
      `select chain_id,transaction_hash,log_index,block_number::text,block_hash,contract_address,event_name,payload,observed_at
       from ${this.schema}.dbc_events where canonical
       and event_name=any($1::text[]) and (block_number,log_index) > ($2::bigint,$3)
       order by block_number,log_index limit $4`,
      [["LaunchpadCreated","LaunchpadMetadataUpdated","LaunchpadOperatorUpdated","LaunchpadOwnerAccepted","LaunchpadTreasuryAccepted","LaunchpadStatusUpdated","LaunchpadFeePolicyUpdated","FeePolicySnapshotted","RevenueSnapshotRegistered","LaunchpadTokenBound","ProofClaimVerified"],afterBlock,afterLogIndex,limit],
    );
  }
}
