-- Additive immutable receipts binding stock-quote launches and executions to policy identities.
create table if not exists zkblast_testnet.stock_quote_launch_policy_bindings (
  chain_id integer not null check (chain_id = 46630),
  launch_id text not null check (launch_id ~ '^0x[0-9a-f]{64}$'),
  quote_asset_address text not null check (quote_asset_address ~ '^0x[0-9a-f]{40}$'),
  policy_identity text not null check (policy_identity ~ '^0x[0-9a-f]{64}$'),
  transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer not null check (log_index >= 0),
  block_number bigint not null check (block_number >= 0),
  block_hash text not null check (block_hash ~ '^0x[0-9a-f]{64}$'),
  observed_at timestamptz not null,
  canonical boolean not null default true,
  primary key (chain_id, launch_id),
  unique (chain_id, transaction_hash, log_index),
  foreign key (chain_id, quote_asset_address)
    references zkblast_testnet.stock_quote_assets(chain_id, contract_address)
);

create table if not exists zkblast_testnet.stock_quote_execution_receipts (
  chain_id integer not null check (chain_id = 46630),
  transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer not null check (log_index >= 0),
  launch_id text not null check (launch_id ~ '^0x[0-9a-f]{64}$'),
  quote_asset_address text not null check (quote_asset_address ~ '^0x[0-9a-f]{40}$'),
  policy_identity text not null check (policy_identity ~ '^0x[0-9a-f]{64}$'),
  is_buy boolean not null,
  quote_amount_raw numeric(78,0) not null check (quote_amount_raw >= 0),
  block_number bigint not null check (block_number >= 0),
  block_hash text not null check (block_hash ~ '^0x[0-9a-f]{64}$'),
  observed_at timestamptz not null,
  canonical boolean not null default true,
  primary key (chain_id, transaction_hash, log_index),
  foreign key (chain_id, quote_asset_address)
    references zkblast_testnet.stock_quote_assets(chain_id, contract_address)
);

create index if not exists stock_quote_launch_policy_asset_idx
  on zkblast_testnet.stock_quote_launch_policy_bindings(chain_id,quote_asset_address,block_number desc);
create index if not exists stock_quote_execution_launch_idx
  on zkblast_testnet.stock_quote_execution_receipts(chain_id,launch_id,block_number desc);

alter table zkblast_testnet.stock_quote_launch_policy_bindings enable row level security;
alter table zkblast_testnet.stock_quote_execution_receipts enable row level security;
revoke all on zkblast_testnet.stock_quote_launch_policy_bindings,
  zkblast_testnet.stock_quote_execution_receipts from public,anon,authenticated;
grant select,insert,update,delete on zkblast_testnet.stock_quote_launch_policy_bindings,
  zkblast_testnet.stock_quote_execution_receipts to service_role;

