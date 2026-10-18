create table if not exists zkblast_testnet.external_market_pairs (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references zkblast_testnet.external_markets(id) on delete cascade,
  data_chain_id bigint not null check (data_chain_id = 4663),
  quote_symbol text not null check (quote_symbol in ('USDG', 'WETH')),
  quote_address text not null check (quote_address ~ '^0x[0-9a-f]{40}$'),
  priority smallint not null check (priority between 1 and 10),
  route_status text not null check (route_status in ('planned', 'observed', 'validated', 'disabled')),
  venue text,
  pool_identifier text,
  fee_tier integer check (fee_tier is null or fee_tier between 0 and 1000000),
  validated_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (market_id, quote_address),
  unique (market_id, priority),
  check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 8192),
  check ((route_status = 'validated' and pool_identifier is not null and validated_at is not null)
    or route_status <> 'validated')
);

create index if not exists external_market_pairs_discovery_idx
  on zkblast_testnet.external_market_pairs (quote_symbol, route_status, priority);

alter table zkblast_testnet.external_market_pairs enable row level security;
revoke all on zkblast_testnet.external_market_pairs from public, anon, authenticated;
grant select, insert, update, delete on zkblast_testnet.external_market_pairs to service_role;

comment on table zkblast_testnet.external_market_pairs is 'Mainnet pair candidates. Presence never implies an executable ZKBLAST testnet route.';
