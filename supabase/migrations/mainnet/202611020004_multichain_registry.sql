create table if not exists zkblast_mainnet.chain_registry (
  chain_id bigint primary key check (chain_id > 0),
  chain_key text not null unique check (chain_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  chain_name text not null check (char_length(chain_name) between 1 and 80),
  environment text not null check (environment in ('testnet','mainnet')),
  native_currency_symbol text not null check (native_currency_symbol ~ '^[A-Z0-9]{2,12}$'),
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into zkblast_mainnet.chain_registry (
  chain_id,
  chain_key,
  chain_name,
  environment,
  native_currency_symbol,
  enabled
) values
  (4663,'robinhood-mainnet','Robinhood Chain','mainnet','ETH',true),
  (999,'hyperevm-mainnet','HyperEVM','mainnet','HYPE',false)
on conflict (chain_id) do update set
  chain_key=excluded.chain_key,
  chain_name=excluded.chain_name,
  environment=excluded.environment,
  native_currency_symbol=excluded.native_currency_symbol,
  updated_at=now();

create table if not exists zkblast_mainnet.chain_projection_health (
  chain_id bigint not null references zkblast_mainnet.chain_registry(chain_id) on delete restrict,
  consumer text not null check (consumer ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  latest_observed_block bigint check (latest_observed_block is null or latest_observed_block >= 0),
  latest_finalized_block bigint check (latest_finalized_block is null or latest_finalized_block >= 0),
  latest_projected_block bigint check (latest_projected_block is null or latest_projected_block >= 0),
  lag_blocks bigint check (lag_blocks is null or lag_blocks >= 0),
  healthy boolean not null default false,
  detail_code text check (detail_code is null or detail_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  checked_at timestamptz not null default now(),
  primary key (chain_id,consumer),
  check (
    latest_finalized_block is null
    or latest_observed_block is null
    or latest_finalized_block <= latest_observed_block
  ),
  check (
    latest_projected_block is null
    or latest_observed_block is null
    or latest_projected_block <= latest_observed_block
  )
);

create index if not exists chain_projection_health_status_idx
  on zkblast_mainnet.chain_projection_health (healthy,checked_at,chain_id);

alter table zkblast_mainnet.chain_registry enable row level security;
alter table zkblast_mainnet.chain_projection_health enable row level security;
revoke all on zkblast_mainnet.chain_registry,zkblast_mainnet.chain_projection_health from public,anon,authenticated;
grant select,insert,update,delete on zkblast_mainnet.chain_registry,zkblast_mainnet.chain_projection_health to service_role;
