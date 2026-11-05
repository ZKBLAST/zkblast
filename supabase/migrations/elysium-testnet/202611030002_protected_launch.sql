-- Additive projections for Protected Launch policy, identity, allocation and graduation state.
create table if not exists zkblast_elysium_testnet.protected_launch_policies (
  chain_id integer not null check (chain_id = 99801),
  policy_id numeric(78,0) not null,
  family_id text not null check (family_id ~ '^0x[0-9a-f]{64}$'),
  policy_hash text not null check (policy_hash ~ '^0x[0-9a-f]{64}$'),
  version integer not null check (version > 0),
  protection_blocks bigint not null check (protection_blocks > 0),
  max_buy_bps_per_transaction integer not null check (max_buy_bps_per_transaction between 1 and 10000),
  max_buy_bps_per_address integer not null check (max_buy_bps_per_address between max_buy_bps_per_transaction and 10000),
  initial_fee_bps integer not null check (initial_fee_bps between 0 and 10000),
  base_fee_bps integer not null check (base_fee_bps between 0 and initial_fee_bps),
  lp_lock_seconds bigint not null check (lp_lock_seconds > 0),
  enabled boolean not null,
  used boolean not null,
  transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer not null check (log_index >= 0),
  block_number bigint not null check (block_number >= 0),
  block_hash text not null check (block_hash ~ '^0x[0-9a-f]{64}$'),
  canonical boolean not null default true,
  observed_at timestamptz not null,
  primary key (chain_id,policy_id), unique (chain_id,policy_hash)
);

create table if not exists zkblast_elysium_testnet.protected_launches (
  chain_id integer not null check (chain_id = 99801),
  launch_id text not null check (launch_id ~ '^0x[0-9a-f]{64}$'),
  template_id numeric(78,0) not null,
  policy_id numeric(78,0) not null,
  policy_hash text not null check (policy_hash ~ '^0x[0-9a-f]{64}$'),
  creator_address text not null check (creator_address ~ '^0x[0-9a-f]{40}$'),
  token_address text not null check (token_address ~ '^0x[0-9a-f]{40}$'),
  pool_address text not null check (pool_address ~ '^0x[0-9a-f]{40}$'),
  quote_token_address text not null check (quote_token_address ~ '^0x[0-9a-f]{40}$'),
  protection_start_block bigint not null check (protection_start_block >= 0),
  lifecycle smallint not null default 1 check (lifecycle between 0 and 4),
  transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer not null check (log_index >= 0),
  block_number bigint not null check (block_number >= 0),
  block_hash text not null check (block_hash ~ '^0x[0-9a-f]{64}$'),
  canonical boolean not null default true,
  observed_at timestamptz not null,
  primary key (chain_id,launch_id),
  unique (chain_id,token_address), unique (chain_id,pool_address),
  foreign key (chain_id,policy_id) references zkblast_elysium_testnet.protected_launch_policies(chain_id,policy_id)
);

create table if not exists zkblast_elysium_testnet.protected_launch_identities (
  chain_id integer not null check (chain_id = 99801),
  launch_id text not null check (launch_id ~ '^0x[0-9a-f]{64}$'),
  canonical_hash text not null check (canonical_hash ~ '^0x[0-9a-f]{64}$'),
  name_commitment text not null check (name_commitment ~ '^0x[0-9a-f]{64}$'),
  symbol_commitment text not null check (symbol_commitment ~ '^0x[0-9a-f]{64}$'),
  metadata_hash text not null check (metadata_hash ~ '^0x[0-9a-f]{64}$'),
  social_hash text not null check (social_hash ~ '^0x[0-9a-f]{64}$'),
  token_runtime_code_hash text not null check (token_runtime_code_hash ~ '^0x[0-9a-f]{64}$'),
  launchpad_id numeric(78,0) not null,
  token_template_version integer not null check (token_template_version > 0),
  duplicate_name boolean not null,
  duplicate_symbol boolean not null,
  transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer not null check (log_index >= 0),
  block_number bigint not null check (block_number >= 0),
  block_hash text not null check (block_hash ~ '^0x[0-9a-f]{64}$'),
  canonical boolean not null default true,
  observed_at timestamptz not null,
  primary key (chain_id,launch_id),
  foreign key (chain_id,launch_id) references zkblast_elysium_testnet.protected_launches(chain_id,launch_id) on delete cascade
);

create table if not exists zkblast_elysium_testnet.protected_buy_allocations (
  chain_id integer not null check (chain_id = 99801),
  launch_id text not null check (launch_id ~ '^0x[0-9a-f]{64}$'),
  buyer_address text not null check (buyer_address ~ '^0x[0-9a-f]{40}$'),
  purchased_raw numeric(78,0) not null check (purchased_raw >= 0),
  last_transaction_hash text not null check (last_transaction_hash ~ '^0x[0-9a-f]{64}$'),
  last_log_index integer not null check (last_log_index >= 0),
  last_block_number bigint not null check (last_block_number >= 0),
  last_block_hash text not null check (last_block_hash ~ '^0x[0-9a-f]{64}$'),
  canonical boolean not null default true,
  updated_at timestamptz not null,
  primary key (chain_id,launch_id,buyer_address),
  foreign key (chain_id,launch_id) references zkblast_elysium_testnet.protected_launches(chain_id,launch_id) on delete cascade
);

create table if not exists zkblast_elysium_testnet.protected_lp_allocations (
  chain_id integer not null check (chain_id = 99801),
  migration_id text not null check (migration_id ~ '^0x[0-9a-f]{64}$'),
  launch_id text not null check (launch_id ~ '^0x[0-9a-f]{64}$'),
  pool_address text not null check (pool_address ~ '^0x[0-9a-f]{40}$'),
  creator_address text not null check (creator_address ~ '^0x[0-9a-f]{40}$'),
  protocol_recipient text not null check (protocol_recipient ~ '^0x[0-9a-f]{40}$'),
  creator_shares numeric(78,0) not null check (creator_shares >= 0),
  protocol_shares numeric(78,0) not null check (protocol_shares >= 0),
  creator_unlock_at timestamptz not null,
  is_dlmm boolean not null,
  bin_id integer,
  creator_claimed boolean not null default false,
  protocol_claimed boolean not null default false,
  transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer not null check (log_index >= 0),
  block_number bigint not null check (block_number >= 0),
  block_hash text not null check (block_hash ~ '^0x[0-9a-f]{64}$'),
  canonical boolean not null default true,
  observed_at timestamptz not null,
  primary key (chain_id,migration_id),
  foreign key (chain_id,launch_id) references zkblast_elysium_testnet.protected_launches(chain_id,launch_id) on delete cascade,
  check ((is_dlmm and bin_id is not null) or (not is_dlmm and bin_id is null))
);

create table if not exists zkblast_elysium_testnet.protected_graduation_migrations (
  chain_id integer not null check (chain_id = 99801),
  migration_id text not null check (migration_id ~ '^0x[0-9a-f]{64}$'),
  launch_id text not null check (launch_id ~ '^0x[0-9a-f]{64}$'),
  source_pool_address text not null check (source_pool_address ~ '^0x[0-9a-f]{40}$'),
  adapter_address text not null check (adapter_address ~ '^0x[0-9a-f]{40}$'),
  destination_pool_address text check (destination_pool_address is null or destination_pool_address ~ '^0x[0-9a-f]{40}$'),
  status smallint not null check (status between 0 and 5),
  attempts integer not null check (attempts between 0 and 255),
  last_failure_hash text check (last_failure_hash is null or last_failure_hash ~ '^0x[0-9a-f]{64}$'),
  destination_shares numeric(78,0),
  accounting_reconciles boolean not null default false,
  last_block_number bigint not null check (last_block_number >= 0),
  last_block_hash text not null check (last_block_hash ~ '^0x[0-9a-f]{64}$'),
  canonical boolean not null default true,
  updated_at timestamptz not null,
  primary key (chain_id,migration_id),
  unique (chain_id,launch_id),
  foreign key (chain_id,launch_id) references zkblast_elysium_testnet.protected_launches(chain_id,launch_id) on delete cascade
);

create table if not exists zkblast_elysium_testnet.protected_invariant_alerts (
  chain_id integer not null check (chain_id = 99801),
  alert_id text not null,
  launch_id text check (launch_id is null or launch_id ~ '^0x[0-9a-f]{64}$'),
  migration_id text check (migration_id is null or migration_id ~ '^0x[0-9a-f]{64}$'),
  invariant_code text not null check (invariant_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  severity text not null check (severity in ('info','warning','critical')),
  details jsonb not null default '{}'::jsonb,
  resolved boolean not null default false,
  detected_block bigint not null check (detected_block >= 0),
  detected_at timestamptz not null,
  primary key (chain_id,alert_id),
  check (launch_id is not null or migration_id is not null)
);

create index if not exists protected_launches_block_idx on zkblast_elysium_testnet.protected_launches(chain_id,block_number desc);
create index if not exists protected_identity_duplicate_idx on zkblast_elysium_testnet.protected_launch_identities(chain_id,duplicate_name,duplicate_symbol);
create index if not exists protected_allocations_buyer_idx on zkblast_elysium_testnet.protected_buy_allocations(chain_id,buyer_address,last_block_number desc);
create index if not exists protected_lp_unlock_idx on zkblast_elysium_testnet.protected_lp_allocations(chain_id,creator_unlock_at) where not creator_claimed;
create index if not exists protected_migrations_status_idx on zkblast_elysium_testnet.protected_graduation_migrations(chain_id,status,last_block_number desc);
create index if not exists protected_alerts_open_idx on zkblast_elysium_testnet.protected_invariant_alerts(chain_id,severity,detected_block desc) where not resolved;

alter table zkblast_elysium_testnet.protected_launch_policies enable row level security;
alter table zkblast_elysium_testnet.protected_launches enable row level security;
alter table zkblast_elysium_testnet.protected_launch_identities enable row level security;
alter table zkblast_elysium_testnet.protected_buy_allocations enable row level security;
alter table zkblast_elysium_testnet.protected_lp_allocations enable row level security;
alter table zkblast_elysium_testnet.protected_graduation_migrations enable row level security;
alter table zkblast_elysium_testnet.protected_invariant_alerts enable row level security;

revoke all on zkblast_elysium_testnet.protected_launch_policies,zkblast_elysium_testnet.protected_launches,zkblast_elysium_testnet.protected_launch_identities,zkblast_elysium_testnet.protected_buy_allocations,zkblast_elysium_testnet.protected_lp_allocations,zkblast_elysium_testnet.protected_graduation_migrations,zkblast_elysium_testnet.protected_invariant_alerts from public,anon,authenticated;
grant select,insert,update,delete on zkblast_elysium_testnet.protected_launch_policies,zkblast_elysium_testnet.protected_launches,zkblast_elysium_testnet.protected_launch_identities,zkblast_elysium_testnet.protected_buy_allocations,zkblast_elysium_testnet.protected_lp_allocations,zkblast_elysium_testnet.protected_graduation_migrations,zkblast_elysium_testnet.protected_invariant_alerts to service_role;
