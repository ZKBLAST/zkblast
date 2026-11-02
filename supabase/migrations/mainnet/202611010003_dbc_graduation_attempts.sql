create table if not exists zkblast_mainnet.dbc_graduation_attempts (
  migration_id text primary key check (migration_id ~ '^0x[0-9a-f]{64}$'),
  launch_id text not null unique references zkblast_mainnet.dbc_launches(launch_id) on delete cascade,
  source_pool text check (source_pool is null or source_pool ~ '^0x[0-9a-f]{40}$'),
  adapter text check (adapter is null or adapter ~ '^0x[0-9a-f]{40}$'),
  status text not null check (status in ('GRADUATING','PENDING_RETRY','GRADUATED','FAILED_NEEDS_REVIEW')),
  attempts smallint not null default 0 check (attempts between 0 and 255),
  failure_hash text check (failure_hash is null or failure_hash ~ '^0x[0-9a-f]{64}$'),
  launchpad_id numeric(78,0), config_hash text, fee_snapshot_id text,
  graduation_destination smallint,
  transaction_hash text check (transaction_hash is null or transaction_hash ~ '^0x[0-9a-f]{64}$'),
  updated_block bigint not null check (updated_block >= 0), updated_at timestamptz not null default now()
);
create index if not exists dbc_graduation_attempts_status_idx on zkblast_mainnet.dbc_graduation_attempts(status,updated_block desc);
alter table zkblast_mainnet.dbc_graduation_attempts enable row level security;
revoke all on zkblast_mainnet.dbc_graduation_attempts from public,anon,authenticated;
grant select,insert,update,delete on zkblast_mainnet.dbc_graduation_attempts to service_role;
