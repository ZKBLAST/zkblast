alter table zkblast_mainnet.trade_history
  add column if not exists gas_used numeric(78, 0),
  add column if not exists effective_gas_price_wei numeric(78, 0);

alter table zkblast_mainnet.trade_history
  add constraint trade_history_gas_used_nonnegative
    check (gas_used is null or gas_used >= 0),
  add constraint trade_history_gas_price_nonnegative
    check (effective_gas_price_wei is null or effective_gas_price_wei >= 0);
