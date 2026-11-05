-- Additive, chain-scoped issuer catalog and stock-quote policy projections.
-- These tables do not authorize onchain trading; the onchain registry remains authoritative.
create table if not exists zkblast_mainnet.stock_quote_catalog_snapshots (
  chain_id integer not null check (chain_id = 4663),
  source_hash text not null check (source_hash ~ '^0x[0-9a-f]{64}$'),
  issuer_name text not null check (char_length(issuer_name) between 1 and 160),
  source_observed_at timestamptz not null,
  ingested_at timestamptz not null default now(),
  asset_count integer not null check (asset_count >= 0),
  primary key (chain_id, source_hash)
);

create table if not exists zkblast_mainnet.stock_quote_assets (
  chain_id integer not null check (chain_id = 4663),
  contract_address text not null check (contract_address ~ '^0x[0-9a-f]{40}$'),
  issuer_asset_id text not null check (issuer_asset_id ~ '^0x[0-9a-f]{64}$'),
  symbol text not null check (char_length(symbol) between 1 and 32),
  instrument_name text not null check (char_length(instrument_name) between 1 and 160),
  issuer_name text not null check (char_length(issuer_name) between 1 and 160),
  token_decimals smallint not null check (token_decimals between 0 and 36),
  current_multiplier numeric(78,18) not null check (current_multiplier > 0),
  pending_multiplier numeric(78,18),
  availability text not null check (availability in ('discovered','verified','eligible','listed','suspended','disabled')),
  market_state text not null check (market_state in ('active','after_hours','closed','halted','degraded','emergency')),
  quote_trading_enabled boolean not null default false,
  graduation_enabled boolean not null default false,
  price_feed_address text check (price_feed_address is null or price_feed_address ~ '^0x[0-9a-f]{40}$'),
  max_oracle_age_seconds integer check (max_oracle_age_seconds is null or max_oracle_age_seconds > 0),
  source_hash text not null check (source_hash ~ '^0x[0-9a-f]{64}$'),
  source_observed_at timestamptz not null,
  updated_at timestamptz not null default now(),
  check (
    not (quote_trading_enabled or graduation_enabled)
    or (availability = 'listed' and price_feed_address is not null and max_oracle_age_seconds is not null)
  ),
  check (not quote_trading_enabled or market_state not in ('halted','degraded','emergency')),
  primary key (chain_id, contract_address),
  unique (chain_id, issuer_asset_id)
);

create table if not exists zkblast_mainnet.stock_quote_policy_events (
  chain_id integer not null check (chain_id = 4663),
  transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer not null check (log_index >= 0),
  contract_address text not null check (contract_address ~ '^0x[0-9a-f]{40}$'),
  policy_version integer not null check (policy_version > 0),
  event_kind text not null check (event_kind in ('listed','updated','disabled','session_updated')),
  configuration_hash text check (configuration_hash is null or configuration_hash ~ '^0x[0-9a-f]{64}$'),
  block_number bigint not null check (block_number >= 0),
  block_hash text not null check (block_hash ~ '^0x[0-9a-f]{64}$'),
  canonical boolean not null default true,
  observed_at timestamptz not null,
  primary key (chain_id, transaction_hash, log_index)
);

create index if not exists stock_quote_assets_availability_idx
  on zkblast_mainnet.stock_quote_assets(chain_id, availability, symbol);
create index if not exists stock_quote_policy_asset_block_idx
  on zkblast_mainnet.stock_quote_policy_events(chain_id, contract_address, block_number desc);

alter table zkblast_mainnet.stock_quote_catalog_snapshots enable row level security;
alter table zkblast_mainnet.stock_quote_assets enable row level security;
alter table zkblast_mainnet.stock_quote_policy_events enable row level security;
revoke all on zkblast_mainnet.stock_quote_catalog_snapshots,
  zkblast_mainnet.stock_quote_assets,
  zkblast_mainnet.stock_quote_policy_events from public, anon, authenticated;
grant select, insert, update, delete on zkblast_mainnet.stock_quote_catalog_snapshots,
  zkblast_mainnet.stock_quote_assets,
  zkblast_mainnet.stock_quote_policy_events to service_role;
