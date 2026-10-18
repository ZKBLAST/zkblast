alter table zkblast_mainnet.external_market_pairs
  add column if not exists execution_chain_id bigint not null default 4663,
  add column if not exists base_address text,
  add column if not exists liquidity_raw numeric,
  add column if not exists observed_block bigint,
  add column if not exists observed_at timestamptz;

alter table zkblast_mainnet.external_market_pairs
  add constraint external_market_pairs_observation_values_check
  check (
    execution_chain_id = 4663
    and (base_address is null or base_address ~ '^0x[0-9a-f]{40}$')
    and (liquidity_raw is null or liquidity_raw >= 0)
    and (observed_block is null or observed_block >= 0)
  );

alter table zkblast_mainnet.external_market_pairs
  add constraint external_market_pairs_validated_observation_check
  check (
    route_status <> 'validated'
    or (
      base_address is not null
      and
      liquidity_raw > 0
      and observed_block is not null
      and observed_at is not null
    )
  );

comment on column zkblast_mainnet.external_market_pairs.liquidity_raw is
  'Protocol-native in-range liquidity. This is not a USD valuation.';

comment on column zkblast_mainnet.external_market_pairs.execution_chain_id is
  'Settlement chain for this candidate. Mainnet records must never point to testnet execution.';
