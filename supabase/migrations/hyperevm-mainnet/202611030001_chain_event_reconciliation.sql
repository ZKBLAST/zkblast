-- Canonical receipts used by deterministic per-chain DBC/launchpad reconciliation.
create table if not exists zkblast_hyperevm_mainnet.dbc_graduation_readiness (
  chain_id integer not null check (chain_id=999), launch_id text not null check (launch_id ~ '^0x[0-9a-f]{64}$'),
  real_quote_reserve_raw numeric(78,0) not null, threshold_raw numeric(78,0) not null check (threshold_raw > 0),
  transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-f]{64}$'), log_index integer not null check (log_index >= 0),
  block_number bigint not null check (block_number >= 0), observed_at timestamptz not null,
  primary key(chain_id,launch_id)
);
create table if not exists zkblast_hyperevm_mainnet.dbc_graduation_adapter_bindings (
  chain_id integer not null check (chain_id=999), migration_id text not null check (migration_id ~ '^0x[0-9a-f]{64}$'),
  adapter_address text not null check (adapter_address ~ '^0x[0-9a-f]{40}$'), factory_address text not null check (factory_address ~ '^0x[0-9a-f]{40}$'),
  adapter_version integer not null check (adapter_version > 0), migration_mode smallint not null check (migration_mode >= 0),
  configuration_hash text not null check (configuration_hash ~ '^0x[0-9a-f]{64}$'), transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer not null check (log_index >= 0), block_number bigint not null check (block_number >= 0), observed_at timestamptz not null,
  primary key(chain_id,migration_id)
);
create table if not exists zkblast_hyperevm_mainnet.launchpad_fee_claim_receipts (
  chain_id integer not null check (chain_id=999), transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer not null check (log_index >= 0), launch_id text check (launch_id is null or launch_id ~ '^0x[0-9a-f]{64}$'),
  snapshot_id text check (snapshot_id is null or snapshot_id ~ '^0x[0-9a-f]{64}$'), launchpad_id numeric(78,0),
  recipient_address text not null check (recipient_address ~ '^0x[0-9a-f]{40}$'), pool_address text check (pool_address is null or pool_address ~ '^0x[0-9a-f]{40}$'),
  asset_address text check (asset_address is null or asset_address ~ '^0x[0-9a-f]{40}$'), allocation smallint,
  amount_raw numeric(78,0) not null check (amount_raw > 0), block_number bigint not null check (block_number >= 0), observed_at timestamptz not null,
  check (launch_id is not null or snapshot_id is not null), primary key(chain_id,transaction_hash,log_index)
);
create table if not exists zkblast_hyperevm_mainnet.launchpad_proof_receipts (
  chain_id integer not null check (chain_id=999), transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer not null check (log_index >= 0), snapshot_id text not null check (snapshot_id ~ '^0x[0-9a-f]{64}$'),
  recipient_address text not null check (recipient_address ~ '^0x[0-9a-f]{40}$'), nullifier text not null check (nullifier ~ '^0x[0-9a-f]{64}$'),
  amount_raw numeric(78,0) not null check (amount_raw > 0), verifier_version numeric(78,0) not null,
  block_number bigint not null check (block_number >= 0), observed_at timestamptz not null,
  primary key(chain_id,transaction_hash,log_index), unique(chain_id,nullifier)
);
create index if not exists dbc_graduation_readiness_block_idx on zkblast_hyperevm_mainnet.dbc_graduation_readiness(chain_id,block_number desc);
create index if not exists dbc_graduation_adapter_block_idx on zkblast_hyperevm_mainnet.dbc_graduation_adapter_bindings(chain_id,block_number desc);
create index if not exists launchpad_fee_claim_block_idx on zkblast_hyperevm_mainnet.launchpad_fee_claim_receipts(chain_id,block_number desc);
create index if not exists launchpad_proof_receipt_block_idx on zkblast_hyperevm_mainnet.launchpad_proof_receipts(chain_id,block_number desc);
alter table zkblast_hyperevm_mainnet.dbc_graduation_readiness enable row level security;
alter table zkblast_hyperevm_mainnet.dbc_graduation_adapter_bindings enable row level security;
alter table zkblast_hyperevm_mainnet.launchpad_fee_claim_receipts enable row level security;
alter table zkblast_hyperevm_mainnet.launchpad_proof_receipts enable row level security;
revoke all on zkblast_hyperevm_mainnet.dbc_graduation_readiness,zkblast_hyperevm_mainnet.dbc_graduation_adapter_bindings,zkblast_hyperevm_mainnet.launchpad_fee_claim_receipts,zkblast_hyperevm_mainnet.launchpad_proof_receipts from public,anon,authenticated;
grant select,insert,update,delete on zkblast_hyperevm_mainnet.dbc_graduation_readiness,zkblast_hyperevm_mainnet.dbc_graduation_adapter_bindings,zkblast_hyperevm_mainnet.launchpad_fee_claim_receipts,zkblast_hyperevm_mainnet.launchpad_proof_receipts to service_role;

