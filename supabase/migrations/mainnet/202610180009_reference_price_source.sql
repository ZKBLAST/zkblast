alter table zkblast_mainnet.external_market_price_points
  drop constraint external_market_price_points_source_check;

alter table zkblast_mainnet.external_market_price_points
  add constraint external_market_price_points_source_check
    check (source in ('swap', 'oracle', 'reference')),
  drop constraint external_market_price_points_check,
  add constraint external_market_price_points_provenance_check
    check ((source = 'swap' and block_number is not null and transaction_hash is not null)
      or (source in ('oracle', 'reference') and transaction_hash is null));

comment on table zkblast_mainnet.external_market_price_points is 'Validated chart observations separated by on-chain swap, verified oracle, or explicitly labeled reference API provenance.';
