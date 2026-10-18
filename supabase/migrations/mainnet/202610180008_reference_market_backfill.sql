update zkblast_mainnet.external_markets
set market_region = 'crypto',
    logo_status = case when logo_status = 'approved' then logo_status else 'missing' end,
    updated_at = now()
where source = 'pons_graduated';

update zkblast_mainnet.external_markets
set candidate_logo_url = metadata ->> 'logoUrl',
    logo_status = case
      when logo_status = 'approved' then logo_status
      when metadata ->> 'logoUrl' ~ '^https://' then 'pending'
      else 'missing'
    end,
    updated_at = now()
where source = 'robinhood_stock_token';
