-- Pools v2 additive read model. Safe to apply before indexer/API adoption.
begin;

alter table zkblast_mainnet.pools
  add column if not exists quote_token_id uuid references zkblast_mainnet.assets(id) on delete restrict,
  add column if not exists bin_step_bps integer;

alter table zkblast_mainnet.pools
  drop constraint if exists pools_bin_step_valid;
alter table zkblast_mainnet.pools
  add constraint pools_bin_step_valid check (
    (pool_kind = 'damm' and bin_step_bps is null) or
    (pool_kind = 'dlmm' and (bin_step_bps is null or bin_step_bps between 1 and 1000))
  );

alter table zkblast_mainnet.pools
  drop constraint if exists pools_quote_token_member;
alter table zkblast_mainnet.pools
  add constraint pools_quote_token_member
  check (quote_token_id is null or quote_token_id = token_x_id or quote_token_id = token_y_id);

alter table zkblast_mainnet.swaps
  add column if not exists side text,
  add column if not exists trader text,
  add column if not exists recipient text,
  add column if not exists active_bin integer,
  add column if not exists reserve0_after_raw numeric(78, 0),
  add column if not exists reserve1_after_raw numeric(78, 0),
  add column if not exists spot_price_x18 numeric(78, 0),
  add column if not exists volume_quote_raw numeric(78, 0);

alter table zkblast_mainnet.swaps
  drop constraint if exists swaps_side_valid,
  drop constraint if exists swaps_trader_valid,
  drop constraint if exists swaps_recipient_valid,
  drop constraint if exists swaps_active_bin_valid,
  drop constraint if exists swaps_reserve0_after_valid,
  drop constraint if exists swaps_reserve1_after_valid,
  drop constraint if exists swaps_spot_price_valid,
  drop constraint if exists swaps_volume_quote_valid;
alter table zkblast_mainnet.swaps
  add constraint swaps_side_valid check (side is null or side in ('buy', 'sell')),
  add constraint swaps_trader_valid check (trader is null or trader ~ '^0x[0-9a-f]{40}$'),
  add constraint swaps_recipient_valid check (recipient is null or recipient ~ '^0x[0-9a-f]{40}$'),
  add constraint swaps_active_bin_valid check (active_bin is null or active_bin between -10000 and 10000),
  add constraint swaps_reserve0_after_valid check (reserve0_after_raw is null or reserve0_after_raw >= 0),
  add constraint swaps_reserve1_after_valid check (reserve1_after_raw is null or reserve1_after_raw >= 0),
  add constraint swaps_spot_price_valid check (spot_price_x18 is null or spot_price_x18 > 0),
  add constraint swaps_volume_quote_valid check (volume_quote_raw is null or volume_quote_raw >= 0);

create table if not exists zkblast_mainnet.pool_state (
  pool_id uuid primary key references zkblast_mainnet.pools(id) on delete cascade,
  chain_id bigint not null check (chain_id > 0),
  reserve0_raw numeric(78, 0) not null default 0 check (reserve0_raw >= 0),
  reserve1_raw numeric(78, 0) not null default 0 check (reserve1_raw >= 0),
  active_bin integer check (active_bin is null or active_bin between -10000 and 10000),
  spot_price_x18 numeric(78, 0) check (spot_price_x18 is null or spot_price_x18 > 0),
  observed_block bigint not null check (observed_block >= 0),
  observed_block_hash text not null check (observed_block_hash ~ '^0x[0-9a-f]{64}$'),
  observed_log_index integer not null check (observed_log_index >= 0),
  observed_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index if not exists pool_state_chain_block_idx
  on zkblast_mainnet.pool_state (chain_id, observed_block desc);

create table if not exists zkblast_mainnet.pool_candles (
  pool_id uuid not null references zkblast_mainnet.pools(id) on delete cascade,
  interval_seconds integer not null check (interval_seconds in (60, 300, 900, 3600, 14400, 86400)),
  bucket_start timestamptz not null,
  open_x18 numeric(78, 0) not null check (open_x18 > 0),
  high_x18 numeric(78, 0) not null check (high_x18 > 0),
  low_x18 numeric(78, 0) not null check (low_x18 > 0),
  close_x18 numeric(78, 0) not null check (close_x18 > 0),
  volume_quote_raw numeric(78, 0) not null default 0 check (volume_quote_raw >= 0),
  trade_count integer not null default 0 check (trade_count >= 0),
  first_block bigint not null check (first_block >= 0),
  last_block bigint not null check (last_block >= first_block),
  updated_at timestamptz not null default now(),
  primary key (pool_id, interval_seconds, bucket_start),
  constraint pool_candles_ohlc_valid check (
    high_x18 >= open_x18 and high_x18 >= close_x18 and
    low_x18 <= open_x18 and low_x18 <= close_x18
  )
);
create index if not exists pool_candles_range_idx
  on zkblast_mainnet.pool_candles (pool_id, interval_seconds, bucket_start desc);

create table if not exists zkblast_mainnet.dlmm_bins (
  pool_id uuid not null references zkblast_mainnet.pools(id) on delete cascade,
  bin_id integer not null check (bin_id between -10000 and 10000),
  reserve0_raw numeric(78, 0) not null check (reserve0_raw >= 0),
  reserve1_raw numeric(78, 0) not null check (reserve1_raw >= 0),
  total_shares_raw numeric(78, 0) not null check (total_shares_raw >= 0),
  price_x18 numeric(78, 0) not null check (price_x18 > 0),
  observed_block bigint not null check (observed_block >= 0),
  observed_block_hash text not null check (observed_block_hash ~ '^0x[0-9a-f]{64}$'),
  observed_at timestamptz not null,
  canonical boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (pool_id, bin_id, observed_block_hash)
);
create index if not exists dlmm_bins_latest_idx
  on zkblast_mainnet.dlmm_bins (pool_id, bin_id, observed_block desc) where canonical;
create index if not exists dlmm_bins_block_idx
  on zkblast_mainnet.dlmm_bins (pool_id, observed_block desc) where canonical;

alter table zkblast_mainnet.pool_state enable row level security;
alter table zkblast_mainnet.pool_candles enable row level security;
alter table zkblast_mainnet.dlmm_bins enable row level security;
revoke all on zkblast_mainnet.pool_state, zkblast_mainnet.pool_candles, zkblast_mainnet.dlmm_bins
  from public, anon, authenticated;
grant select, insert, update, delete
  on zkblast_mainnet.pool_state, zkblast_mainnet.pool_candles, zkblast_mainnet.dlmm_bins
  to service_role;

commit;

