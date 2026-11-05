-- Additive event-time stock quote metadata. Existing rows remain valid and are not rewritten.
alter table zkblast_mainnet.stock_quote_policy_events
  add column if not exists market_state text
    check (market_state is null or market_state in ('active','after_hours','closed','halted','degraded','emergency')),
  add column if not exists multiplier_x18 numeric(78,0)
    check (multiplier_x18 is null or multiplier_x18 > 0),
  add column if not exists policy_observed_at timestamptz;

alter table zkblast_mainnet.stock_quote_execution_receipts
  add column if not exists quote_token_decimals smallint
    check (quote_token_decimals is null or quote_token_decimals between 0 and 36),
  add column if not exists multiplier_x18 numeric(78,0)
    check (multiplier_x18 is null or multiplier_x18 > 0),
  add column if not exists oracle_price_x18 numeric(78,0)
    check (oracle_price_x18 is null or oracle_price_x18 > 0),
  add column if not exists usd_notional_x18 numeric(78,0)
    check (usd_notional_x18 is null or usd_notional_x18 >= 0),
  add column if not exists oracle_updated_at timestamptz,
  add column if not exists oracle_round_id numeric(78,0)
    check (oracle_round_id is null or oracle_round_id >= 0);

create index if not exists stock_quote_policy_observation_idx
  on zkblast_mainnet.stock_quote_policy_events(chain_id,contract_address,block_number desc,log_index desc)
  where event_kind='session_updated' and canonical=true;
