alter table zkblast_mainnet.external_market_pairs
  drop constraint external_market_pairs_quote_symbol_check;

alter table zkblast_mainnet.external_market_pairs
  add constraint external_market_pairs_quote_symbol_check
  check (quote_symbol in ('USDG', 'WETH', 'ETH'));

comment on column zkblast_mainnet.external_market_pairs.quote_symbol is
  'Quoted asset. ETH identifies a native-asset reference route and is not executable by the ERC-20 router until native wrapping support is validated.';
