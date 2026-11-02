alter table zkblast_mainnet.dbc_launches
  add column if not exists launchpad_bound boolean not null default false,
  add column if not exists launchpad_id numeric(78,0),
  add column if not exists fee_snapshot_id text check (fee_snapshot_id is null or fee_snapshot_id ~ '^0x[0-9a-f]{64}$'),
  add column if not exists binding_schema_version integer check (binding_schema_version is null or binding_schema_version > 0),
  add column if not exists launchpad_treasury text check (launchpad_treasury is null or launchpad_treasury ~ '^0x[0-9a-f]{40}$'),
  add column if not exists launchpad_config_preset_id numeric(78,0),
  add column if not exists launchpad_config_hash text check (launchpad_config_hash is null or launchpad_config_hash ~ '^0x[0-9a-f]{64}$'),
  add column if not exists graduation_destination smallint;

create index if not exists dbc_launches_launchpad_idx
  on zkblast_mainnet.dbc_launches (launchpad_id, updated_block desc)
  where launchpad_bound;
