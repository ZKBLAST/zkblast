-- Additive, chain-scoped Assistance Fund receipt and reconciliation projections.
create table if not exists zkblast_mainnet.assistance_fee_sources (
  chain_id integer not null check (chain_id = 4663),
  source_id text not null check (source_id ~ '^0x[0-9a-f]{64}$'),
  source_address text not null check (source_address ~ '^0x[0-9a-f]{40}$'),
  asset_address text not null check (asset_address ~ '^0x[0-9a-f]{40}$'),
  adapter_id text not null check (adapter_id ~ '^0x[0-9a-f]{64}$'),
  status smallint not null check (status between 0 and 2),
  block_number bigint not null check (block_number >= 0),
  transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer not null check (log_index >= 0),
  observed_at timestamptz not null,
  primary key (chain_id, source_id)
);

create table if not exists zkblast_mainnet.assistance_revenue_receipts (
  chain_id integer not null check (chain_id = 4663),
  transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer not null check (log_index >= 0),
  source_id text not null check (source_id ~ '^0x[0-9a-f]{64}$'),
  epoch_id text not null check (epoch_id ~ '^0x[0-9a-f]{64}$'),
  asset_address text not null check (asset_address ~ '^0x[0-9a-f]{40}$'),
  revenue_kind smallint not null check (revenue_kind between 0 and 3),
  gross_amount_raw numeric(78,0) not null check (gross_amount_raw >= 0),
  excluded_obligations_raw numeric(78,0) not null check (excluded_obligations_raw >= 0),
  eligible_amount_raw numeric(78,0) not null check (eligible_amount_raw > 0),
  block_number bigint not null check (block_number >= 0),
  observed_at timestamptz not null,
  check (gross_amount_raw = excluded_obligations_raw + eligible_amount_raw),
  primary key (chain_id, transaction_hash, log_index),
  unique (chain_id, source_id, epoch_id)
);

create table if not exists zkblast_mainnet.assistance_allocations (
  chain_id integer not null check (chain_id = 4663),
  transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer not null check (log_index >= 0),
  source_id text not null check (source_id ~ '^0x[0-9a-f]{64}$'),
  epoch_id text not null check (epoch_id ~ '^0x[0-9a-f]{64}$'),
  asset_address text not null check (asset_address ~ '^0x[0-9a-f]{40}$'),
  eligible_amount_raw numeric(78,0) not null check (eligible_amount_raw > 0),
  buyback_amount_raw numeric(78,0) not null check (buyback_amount_raw >= 0),
  treasury_amount_raw numeric(78,0) not null check (treasury_amount_raw >= 0),
  block_number bigint not null check (block_number >= 0),
  observed_at timestamptz not null,
  check (eligible_amount_raw = buyback_amount_raw + treasury_amount_raw),
  primary key (chain_id, transaction_hash, log_index)
);

create table if not exists zkblast_mainnet.assistance_buyback_receipts (
  chain_id integer not null check (chain_id = 4663),
  transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer not null check (log_index >= 0),
  route_id text not null check (route_id ~ '^0x[0-9a-f]{64}$'),
  asset_in text not null check (asset_in ~ '^0x[0-9a-f]{40}$'),
  protocol_token text not null check (protocol_token ~ '^0x[0-9a-f]{40}$'),
  amount_in_raw numeric(78,0) not null check (amount_in_raw > 0),
  amount_out_raw numeric(78,0) not null check (amount_out_raw > 0),
  reference_price_x18 numeric(78,0) not null,
  execution_price_x18 numeric(78,0) not null,
  executor_address text not null check (executor_address ~ '^0x[0-9a-f]{40}$'),
  block_number bigint not null check (block_number >= 0),
  observed_at timestamptz not null,
  primary key (chain_id, transaction_hash, log_index)
);

create table if not exists zkblast_mainnet.assistance_burn_receipts (
  chain_id integer not null check (chain_id = 4663),
  transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer not null check (log_index >= 0),
  protocol_token text not null check (protocol_token ~ '^0x[0-9a-f]{40}$'),
  burn_method smallint not null check (burn_method between 0 and 1),
  amount_raw numeric(78,0) not null check (amount_raw > 0),
  total_supply_before_raw numeric(78,0) not null,
  total_supply_after_raw numeric(78,0) not null,
  executor_address text not null check (executor_address ~ '^0x[0-9a-f]{40}$'),
  block_number bigint not null check (block_number >= 0),
  observed_at timestamptz not null,
  check (total_supply_before_raw >= total_supply_after_raw),
  primary key (chain_id, transaction_hash, log_index)
);

create table if not exists zkblast_mainnet.assistance_reconciliation_snapshots (
  chain_id integer not null check (chain_id = 4663),
  asset_address text not null check (asset_address ~ '^0x[0-9a-f]{40}$'),
  block_number bigint not null check (block_number >= 0),
  balance_raw numeric(78,0) not null,
  pending_buyback_raw numeric(78,0) not null,
  treasury_claimable_raw numeric(78,0) not null,
  liability_raw numeric(78,0) not null,
  surplus_raw numeric(78,0) not null,
  solvent boolean not null,
  observed_at timestamptz not null,
  primary key (chain_id, asset_address, block_number)
);

create index if not exists assistance_revenue_source_block_idx on zkblast_mainnet.assistance_revenue_receipts(chain_id, source_id, block_number desc);
create index if not exists assistance_buyback_route_block_idx on zkblast_mainnet.assistance_buyback_receipts(chain_id, route_id, block_number desc);
create index if not exists assistance_burn_token_block_idx on zkblast_mainnet.assistance_burn_receipts(chain_id, protocol_token, block_number desc);

alter table zkblast_mainnet.assistance_fee_sources enable row level security;
alter table zkblast_mainnet.assistance_revenue_receipts enable row level security;
alter table zkblast_mainnet.assistance_allocations enable row level security;
alter table zkblast_mainnet.assistance_buyback_receipts enable row level security;
alter table zkblast_mainnet.assistance_burn_receipts enable row level security;
alter table zkblast_mainnet.assistance_reconciliation_snapshots enable row level security;
revoke all on zkblast_mainnet.assistance_fee_sources, zkblast_mainnet.assistance_revenue_receipts, zkblast_mainnet.assistance_allocations, zkblast_mainnet.assistance_buyback_receipts, zkblast_mainnet.assistance_burn_receipts, zkblast_mainnet.assistance_reconciliation_snapshots from public, anon, authenticated;
grant select, insert, update, delete on zkblast_mainnet.assistance_fee_sources, zkblast_mainnet.assistance_revenue_receipts, zkblast_mainnet.assistance_allocations, zkblast_mainnet.assistance_buyback_receipts, zkblast_mainnet.assistance_burn_receipts, zkblast_mainnet.assistance_reconciliation_snapshots to service_role;
