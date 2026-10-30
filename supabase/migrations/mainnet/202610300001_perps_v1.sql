create table zkblast_mainnet.perp_markets (
  market_id text primary key check (market_id ~ '^0x[0-9a-f]{64}$'),
  symbol text not null check (char_length(symbol) between 3 and 32),
  base_asset text not null check (base_asset ~ '^0x[0-9a-f]{40}$'),
  oracle_id text not null check (oracle_id ~ '^0x[0-9a-f]{64}$'),
  max_open_interest_raw numeric(78,0) not null check (max_open_interest_raw > 0),
  max_skew_raw numeric(78,0) not null check (max_skew_raw > 0),
  max_position_raw numeric(78,0) not null check (max_position_raw > 0),
  min_position_raw numeric(78,0) not null check (min_position_raw > 0),
  max_leverage_bps integer not null check (max_leverage_bps between 10000 and 100000),
  maintenance_margin_bps integer not null check (maintenance_margin_bps between 1 and 9999),
  position_fee_bps integer not null check (position_fee_bps between 0 and 9999),
  liquidation_fee_bps integer not null check (liquidation_fee_bps between 0 and 9999),
  max_price_impact_bps integer not null check (max_price_impact_bps between 0 and 9999),
  enabled boolean not null default false,
  paused boolean not null default true,
  long_open_interest_raw numeric(78,0) not null default 0 check (long_open_interest_raw >= 0),
  short_open_interest_raw numeric(78,0) not null default 0 check (short_open_interest_raw >= 0),
  funding_rate_bps_per_hour integer not null default 0,
  funding_index_x18 numeric(78,0) not null default 0,
  funding_updated_at timestamptz,
  updated_block bigint not null check (updated_block >= 0),
  updated_at timestamptz not null default now()
);

create table zkblast_mainnet.perp_positions (
  position_id text primary key check (position_id ~ '^0x[0-9a-f]{64}$'),
  market_id text not null references zkblast_mainnet.perp_markets(market_id) on delete restrict,
  owner_commitment text not null check (owner_commitment ~ '^0x[0-9a-f]{64}$'),
  public_owner_address text check (public_owner_address is null or public_owner_address ~ '^0x[0-9a-f]{40}$'),
  is_long boolean not null,
  margin_raw numeric(78,0) not null check (margin_raw >= 0),
  notional_raw numeric(78,0) not null check (notional_raw > 0),
  base_size_raw numeric(78,0) not null check (base_size_raw > 0),
  entry_price_x18 numeric(78,0) not null check (entry_price_x18 > 0),
  funding_index_x18 numeric(78,0) not null,
  status text not null check (status in ('open','closed','liquidated')),
  opened_transaction_hash text not null check (opened_transaction_hash ~ '^0x[0-9a-f]{64}$'),
  closed_transaction_hash text check (closed_transaction_hash is null or closed_transaction_hash ~ '^0x[0-9a-f]{64}$'),
  opened_block bigint not null check (opened_block >= 0),
  closed_block bigint check (closed_block is null or closed_block >= opened_block),
  opened_at timestamptz not null,
  closed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index perp_positions_market_status_idx on zkblast_mainnet.perp_positions (market_id,status,opened_block desc);
create index perp_positions_owner_status_idx on zkblast_mainnet.perp_positions (owner_commitment,status,opened_block desc);
create index perp_positions_public_owner_idx on zkblast_mainnet.perp_positions (public_owner_address,status,opened_block desc) where public_owner_address is not null;

create table zkblast_mainnet.perp_market_catalog (
  pool_address text primary key check (pool_address ~ '^0x[0-9a-f]{40}$'),
  pool_model text not null check (pool_model in ('damm','dlmm')),
  base_address text not null check (base_address ~ '^0x[0-9a-f]{40}$'),
  base_symbol text not null check (char_length(base_symbol) between 1 and 24),
  quote_address text not null check (quote_address ~ '^0x[0-9a-f]{40}$'),
  quote_symbol text not null check (char_length(quote_symbol) between 1 and 24),
  pool_status text not null check (pool_status in ('active','paused','retired')),
  registered_market_id text references zkblast_mainnet.perp_markets(market_id) on delete set null,
  updated_at timestamptz not null default now()
);
create index perp_market_catalog_status_idx on zkblast_mainnet.perp_market_catalog (pool_status,pool_model,base_symbol,quote_symbol);

create table zkblast_mainnet.perp_events (
  chain_id bigint not null check (chain_id > 0),
  transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer not null check (log_index >= 0),
  block_number bigint not null check (block_number >= 0),
  block_hash text not null check (block_hash ~ '^0x[0-9a-f]{64}$'),
  block_timestamp timestamptz not null,
  event_kind text not null check (event_kind in ('market','funding','open','close','liquidation','lp_deposit','lp_redeem','insurance')),
  market_id text check (market_id is null or market_id ~ '^0x[0-9a-f]{64}$'),
  position_id text check (position_id is null or position_id ~ '^0x[0-9a-f]{64}$'),
  payload jsonb not null check (jsonb_typeof(payload)='object'),
  canonical boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (chain_id,transaction_hash,log_index)
);
create index perp_events_market_time_idx on zkblast_mainnet.perp_events (market_id,block_number desc,log_index desc) where canonical;
create index perp_events_position_idx on zkblast_mainnet.perp_events (position_id,block_number desc,log_index desc) where canonical;

create table zkblast_mainnet.perp_oracle_prices (
  market_id text not null references zkblast_mainnet.perp_markets(market_id) on delete cascade,
  block_number bigint not null check (block_number >= 0),
  block_hash text not null check (block_hash ~ '^0x[0-9a-f]{64}$'),
  price_x18 numeric(78,0) not null check (price_x18 > 0),
  oracle_updated_at timestamptz not null,
  canonical boolean not null default true,
  primary key (market_id,block_number)
);
create index perp_oracle_prices_latest_idx on zkblast_mainnet.perp_oracle_prices (market_id,block_number desc) where canonical;

create table zkblast_mainnet.perp_lp_activity (
  chain_id bigint not null, transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer not null check (log_index >= 0), block_number bigint not null check (block_number >= 0),
  block_hash text not null check (block_hash ~ '^0x[0-9a-f]{64}$'), account text not null check (account ~ '^0x[0-9a-f]{40}$'),
  event_kind text not null check (event_kind in ('deposit','redeem')), assets_raw numeric(78,0) not null check (assets_raw > 0),
  shares_raw numeric(78,0) not null check (shares_raw > 0), observed_at timestamptz not null, canonical boolean not null default true,
  primary key (chain_id,transaction_hash,log_index)
);
create index perp_lp_activity_account_idx on zkblast_mainnet.perp_lp_activity (account,block_number desc,log_index desc) where canonical;

create table zkblast_mainnet.perp_insurance_activity (
  chain_id bigint not null, transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer not null check (log_index >= 0), block_number bigint not null check (block_number >= 0),
  block_hash text not null check (block_hash ~ '^0x[0-9a-f]{64}$'), event_kind text not null check (event_kind in ('funded','covered')),
  account text not null check (account ~ '^0x[0-9a-f]{40}$'), amount_raw numeric(78,0) not null check (amount_raw > 0),
  observed_at timestamptz not null, canonical boolean not null default true,
  primary key (chain_id,transaction_hash,log_index)
);
create index perp_insurance_activity_time_idx on zkblast_mainnet.perp_insurance_activity (block_number desc,log_index desc) where canonical;

create table zkblast_mainnet.perp_vault_snapshots (
  block_number bigint primary key check (block_number >= 0),
  block_hash text not null check (block_hash ~ '^0x[0-9a-f]{64}$'),
  total_assets_raw numeric(78,0) not null check (total_assets_raw >= 0),
  lp_assets_raw numeric(78,0) not null check (lp_assets_raw >= 0),
  available_liquidity_raw numeric(78,0) not null check (available_liquidity_raw >= 0),
  trader_margin_liability_raw numeric(78,0) not null check (trader_margin_liability_raw >= 0),
  reserved_profit_liquidity_raw numeric(78,0) not null check (reserved_profit_liquidity_raw >= 0),
  total_shares_raw numeric(78,0) not null check (total_shares_raw >= 0),
  insurance_assets_raw numeric(78,0) not null check (insurance_assets_raw >= 0),
  observed_at timestamptz not null
);

alter table zkblast_mainnet.perp_markets enable row level security;
alter table zkblast_mainnet.perp_positions enable row level security;
alter table zkblast_mainnet.perp_market_catalog enable row level security;
alter table zkblast_mainnet.perp_events enable row level security;
alter table zkblast_mainnet.perp_oracle_prices enable row level security;
alter table zkblast_mainnet.perp_lp_activity enable row level security;
alter table zkblast_mainnet.perp_insurance_activity enable row level security;
alter table zkblast_mainnet.perp_vault_snapshots enable row level security;
revoke all on zkblast_mainnet.perp_markets, zkblast_mainnet.perp_positions, zkblast_mainnet.perp_market_catalog, zkblast_mainnet.perp_events, zkblast_mainnet.perp_oracle_prices, zkblast_mainnet.perp_lp_activity, zkblast_mainnet.perp_insurance_activity, zkblast_mainnet.perp_vault_snapshots from public, anon, authenticated;
grant select,insert,update,delete on zkblast_mainnet.perp_markets, zkblast_mainnet.perp_positions, zkblast_mainnet.perp_market_catalog, zkblast_mainnet.perp_events, zkblast_mainnet.perp_oracle_prices, zkblast_mainnet.perp_lp_activity, zkblast_mainnet.perp_insurance_activity, zkblast_mainnet.perp_vault_snapshots to service_role;

