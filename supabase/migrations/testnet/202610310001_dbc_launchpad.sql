create table zkblast_testnet.dbc_templates (
  template_id numeric(78,0) primary key, family_id text not null check (family_id ~ '^0x[0-9a-f]{64}$'),
  config_hash text not null check (config_hash ~ '^0x[0-9a-f]{64}$'), version integer not null check (version > 0),
  enabled boolean not null, used boolean not null default false, updated_block bigint not null check (updated_block >= 0),
  updated_at timestamptz not null default now(), unique(family_id,version)
);
create table zkblast_testnet.dbc_launches (
  launch_id text primary key check (launch_id ~ '^0x[0-9a-f]{64}$'), template_id numeric(78,0) not null,
  creator text not null check (creator ~ '^0x[0-9a-f]{40}$'), token_address text not null unique check (token_address ~ '^0x[0-9a-f]{40}$'),
  virtual_pool text not null unique check (virtual_pool ~ '^0x[0-9a-f]{40}$'), quote_token text not null check (quote_token ~ '^0x[0-9a-f]{40}$'),
  name text check (name is null or char_length(name) between 1 and 128), symbol text check (symbol is null or char_length(symbol) between 1 and 32),
  metadata_uri text check (metadata_uri is null or char_length(metadata_uri) <= 2048), lifecycle smallint not null check (lifecycle between 0 and 4),
  real_quote_reserve_raw numeric(78,0) not null default 0, base_sold_raw numeric(78,0) not null default 0,
  graduation_threshold_raw numeric(78,0) check (graduation_threshold_raw is null or graduation_threshold_raw > 0),
  created_block bigint not null check (created_block >= 0), updated_block bigint not null check (updated_block >= created_block), updated_at timestamptz not null default now()
);
create index dbc_launches_discovery_idx on zkblast_testnet.dbc_launches (lifecycle,updated_block desc,launch_id);
create table zkblast_testnet.dbc_events (
  chain_id bigint not null check (chain_id > 0), transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer not null check (log_index >= 0), block_number bigint not null check (block_number >= 0),
  block_hash text not null check (block_hash ~ '^0x[0-9a-f]{64}$'), contract_address text not null check (contract_address ~ '^0x[0-9a-f]{40}$'),
  event_name text not null, launch_id text check (launch_id is null or launch_id ~ '^0x[0-9a-f]{64}$'), payload jsonb not null check (jsonb_typeof(payload)='object'),
  canonical boolean not null default true, observed_at timestamptz not null, primary key(chain_id,transaction_hash,log_index)
);
create index dbc_events_launch_idx on zkblast_testnet.dbc_events (launch_id,block_number desc,log_index desc) where canonical;
create table zkblast_testnet.dbc_swaps (
  chain_id bigint not null, transaction_hash text not null, log_index integer not null, launch_id text not null references zkblast_testnet.dbc_launches(launch_id) on delete cascade,
  trader text not null check (trader ~ '^0x[0-9a-f]{40}$'), recipient text not null check (recipient ~ '^0x[0-9a-f]{40}$'), is_buy boolean not null,
  quote_amount_raw numeric(78,0) not null check (quote_amount_raw > 0), base_amount_raw numeric(78,0) not null check (base_amount_raw > 0),
  fee_raw numeric(78,0) not null check (fee_raw >= 0), price_x18 numeric(78,0) not null check (price_x18 > 0),
  block_number bigint not null, block_hash text not null, observed_at timestamptz not null, canonical boolean not null default true,
  primary key(chain_id,transaction_hash,log_index)
);
create index dbc_swaps_chart_idx on zkblast_testnet.dbc_swaps (launch_id,observed_at,block_number,log_index) where canonical;
create table zkblast_testnet.dbc_holder_balances (
  launch_id text not null references zkblast_testnet.dbc_launches(launch_id) on delete cascade,
  account text not null check (account ~ '^0x[0-9a-f]{40}$'), balance_raw numeric(78,0) not null check (balance_raw >= 0),
  updated_block bigint not null check (updated_block >= 0), primary key(launch_id,account)
);
create index dbc_holder_balances_count_idx on zkblast_testnet.dbc_holder_balances (launch_id,balance_raw) where balance_raw > 0;
create table zkblast_testnet.dbc_graduations (
  migration_id text primary key check (migration_id ~ '^0x[0-9a-f]{64}$'), launch_id text not null unique references zkblast_testnet.dbc_launches(launch_id) on delete restrict,
  destination_pool text not null unique check (destination_pool ~ '^0x[0-9a-f]{40}$'), base_migrated_raw numeric(78,0) not null,
  quote_migrated_raw numeric(78,0) not null, destination_shares_raw numeric(78,0) not null check (destination_shares_raw > 0),
  transaction_hash text not null, block_number bigint not null, observed_at timestamptz not null
);
create table zkblast_testnet.dbc_lp_allocations (
  migration_id text not null references zkblast_testnet.dbc_graduations(migration_id) on delete cascade,
  allocation_kind text not null check (allocation_kind in ('creator','protocol')), recipient text not null check (recipient ~ '^0x[0-9a-f]{40}$'),
  shares_raw numeric(78,0) not null check (shares_raw >= 0), unlock_at timestamptz, claimed boolean not null default false,
  claim_transaction_hash text, updated_block bigint not null, primary key(migration_id,allocation_kind)
);
create table zkblast_testnet.dbc_monitoring (
  consumer text primary key, indexed_block bigint not null, finalized_block bigint not null, lag_blocks bigint not null,
  reorg_count bigint not null default 0, invalid_event_count bigint not null default 0, quote_divergence_count bigint not null default 0,
  ready_launch_count bigint not null default 0, updated_at timestamptz not null default now()
);
alter table zkblast_testnet.dbc_templates enable row level security; alter table zkblast_testnet.dbc_launches enable row level security;
alter table zkblast_testnet.dbc_events enable row level security; alter table zkblast_testnet.dbc_swaps enable row level security;
alter table zkblast_testnet.dbc_holder_balances enable row level security;
alter table zkblast_testnet.dbc_graduations enable row level security; alter table zkblast_testnet.dbc_lp_allocations enable row level security;
alter table zkblast_testnet.dbc_monitoring enable row level security;
revoke all on zkblast_testnet.dbc_templates,zkblast_testnet.dbc_launches,zkblast_testnet.dbc_events,zkblast_testnet.dbc_swaps,zkblast_testnet.dbc_holder_balances,zkblast_testnet.dbc_graduations,zkblast_testnet.dbc_lp_allocations,zkblast_testnet.dbc_monitoring from public,anon,authenticated;
grant select,insert,update,delete on zkblast_testnet.dbc_templates,zkblast_testnet.dbc_launches,zkblast_testnet.dbc_events,zkblast_testnet.dbc_swaps,zkblast_testnet.dbc_holder_balances,zkblast_testnet.dbc_graduations,zkblast_testnet.dbc_lp_allocations,zkblast_testnet.dbc_monitoring to service_role;
