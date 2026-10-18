create table if not exists zkblast_mainnet.external_markets (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('pons_graduated', 'robinhood_stock_token')),
  external_id text not null,
  chain_id bigint not null check (chain_id = 4663),
  contract_address text not null check (contract_address ~ '^0x[0-9a-f]{40}$'),
  symbol text not null check (char_length(symbol) between 1 and 32),
  name text not null check (char_length(name) between 1 and 160),
  quote_symbol text not null check (char_length(quote_symbol) between 1 and 16),
  status text not null check (status in ('active', 'halted', 'inactive')),
  read_only boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  validated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id),
  check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 16384)
);

create index if not exists external_markets_source_status_idx
  on zkblast_mainnet.external_markets (source, status, symbol);

create table if not exists zkblast_mainnet.external_market_quotes (
  market_id uuid not null references zkblast_mainnet.external_markets(id) on delete cascade,
  observed_at timestamptz not null,
  bid numeric,
  ask numeric,
  currency text not null check (char_length(currency) between 1 and 16),
  daily_volume numeric,
  source_hash text not null check (source_hash ~ '^0x[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (market_id, observed_at),
  check (bid is null or bid >= 0),
  check (ask is null or ask >= 0),
  check (bid is null or ask is null or ask >= bid),
  check (daily_volume is null or daily_volume >= 0)
);

create index if not exists external_market_quotes_latest_idx
  on zkblast_mainnet.external_market_quotes (market_id, observed_at desc);

alter table zkblast_mainnet.external_markets enable row level security;
alter table zkblast_mainnet.external_market_quotes enable row level security;

revoke all on zkblast_mainnet.external_markets from public, anon, authenticated;
revoke all on zkblast_mainnet.external_market_quotes from public, anon, authenticated;
grant select, insert, update, delete on zkblast_mainnet.external_markets to service_role;
grant select, insert, update, delete on zkblast_mainnet.external_market_quotes to service_role;

comment on table zkblast_mainnet.external_markets is 'Server-validated external market catalog. Never written directly by browsers.';
comment on table zkblast_mainnet.external_market_quotes is 'Validated immutable snapshots; never use these as executable swap quotes.';
