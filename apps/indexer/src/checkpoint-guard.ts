import type postgres from "postgres";

/** Older workers may still run during rollout: reject their stale transactions atomically. */
export async function installCheckpointGuard(
  sql: postgres.Sql,
  schema: string,
) {
  if (!/^zkblast_(mainnet|testnet)$/u.test(schema))
    throw new Error("INVALID_DATABASE_SCHEMA");
  await sql.begin(async (tx) => {
    await tx.unsafe(`create or replace function ${schema}.guard_protocol_checkpoint()
      returns trigger language plpgsql security invoker set search_path='' as $$
      begin
        if new.consumer='protocol' and coalesce(current_setting('zkblast.allow_checkpoint_rewind',true),'') <> 'on'
          and (new.last_processed_block < old.last_processed_block
            or (new.last_processed_block=old.last_processed_block and new.last_processed_hash<>old.last_processed_hash)) then
          raise exception 'STALE_INDEXER_CHECKPOINT' using errcode='40001';
        end if;
        return new;
      end; $$`);
    await tx.unsafe(`create or replace trigger guard_protocol_checkpoint before update on ${schema}.ingestion_checkpoints
      for each row execute function ${schema}.guard_protocol_checkpoint()`);
  });
}
