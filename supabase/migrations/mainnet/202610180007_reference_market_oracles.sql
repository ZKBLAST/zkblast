alter table zkblast_mainnet.external_markets
  add column if not exists execution_chain_id bigint,
  add column if not exists market_region text not null default 'unclassified',
  add column if not exists market_cap_usd numeric,
  add column if not exists market_cap_observed_at timestamptz,
  add column if not exists candidate_logo_url text,
  add column if not exists logo_url text,
  add column if not exists logo_status text not null default 'pending',
  add column if not exists logo_validated_at timestamptz,
  add column if not exists oracle_provider text,
  add column if not exists oracle_feed_id text;

alter table zkblast_mainnet.external_markets
  add constraint external_markets_execution_chain_check
    check (execution_chain_id is null or execution_chain_id in (4663, 46630)),
  add constraint external_markets_region_check
    check (market_region in ('unclassified', 'crypto', 'us', 'china')),
  add constraint external_markets_market_cap_check
    check (market_cap_usd is null or market_cap_usd >= 0),
  add constraint external_markets_logo_status_check
    check (logo_status in ('pending', 'approved', 'rejected', 'missing')),
  add constraint external_markets_logo_approval_check
    check ((logo_status = 'approved' and logo_url is not null and logo_validated_at is not null)
      or (logo_status <> 'approved' and logo_url is null));

create index if not exists external_markets_discovery_idx
  on zkblast_mainnet.external_markets
  (market_region, market_cap_usd desc nulls last, status);

create table if not exists zkblast_mainnet.external_market_price_points (
  market_id uuid not null references zkblast_mainnet.external_markets(id) on delete cascade,
  source text not null check (source in ('swap', 'oracle')),
  observed_at timestamptz not null,
  price numeric not null check (price > 0),
  volume numeric check (volume is null or volume >= 0),
  block_number bigint check (block_number is null or block_number >= 0),
  transaction_hash text check (transaction_hash is null or transaction_hash ~ '^0x[0-9a-f]{64}$'),
  source_hash text not null check (source_hash ~ '^0x[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (market_id, source, observed_at, source_hash),
  check ((source = 'swap' and block_number is not null and transaction_hash is not null)
    or (source = 'oracle' and transaction_hash is null))
);

create index if not exists external_market_price_points_chart_idx
  on zkblast_mainnet.external_market_price_points
  (market_id, source, observed_at desc);

alter table zkblast_mainnet.external_market_price_points enable row level security;
revoke all on zkblast_mainnet.external_market_price_points from public, anon, authenticated;
grant select, insert, update, delete on zkblast_mainnet.external_market_price_points to service_role;

comment on column zkblast_mainnet.external_markets.chain_id is 'Mainnet chain from which reference market data was observed.';
comment on column zkblast_mainnet.external_markets.execution_chain_id is 'Chain on which an independently validated executable route exists; null means display-only.';
comment on column zkblast_mainnet.external_markets.candidate_logo_url is 'Untrusted provider candidate; never returned as an approved logo.';
comment on table zkblast_mainnet.external_market_price_points is 'Validated chart observations separated by on-chain swap or cryptographically verified oracle provenance.';
