-- Sparse catch-up and the legacy worker may overlap during a deployment rollout.
create or replace function zkblast_testnet.guard_protocol_checkpoint()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.consumer='protocol'
    and coalesce(current_setting('zkblast.allow_checkpoint_rewind',true),'') <> 'on'
    and (new.last_processed_block < old.last_processed_block
      or (new.last_processed_block=old.last_processed_block and new.last_processed_hash<>old.last_processed_hash)) then
    raise exception 'STALE_INDEXER_CHECKPOINT' using errcode='40001';
  end if;
  return new;
end; $$;

create or replace trigger guard_protocol_checkpoint
before update on zkblast_testnet.ingestion_checkpoints
for each row execute function zkblast_testnet.guard_protocol_checkpoint();
