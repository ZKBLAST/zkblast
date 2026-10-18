create table if not exists zkblast_mainnet.external_market_curation_audit (
  id bigint generated always as identity primary key,
  market_id uuid not null references zkblast_mainnet.external_markets(id) on delete cascade,
  field_name text not null check (field_name in ('market_region', 'logo_status')),
  previous_value text,
  next_value text not null,
  reason text not null check (char_length(reason) between 3 and 500),
  curator text not null check (char_length(curator) between 3 and 100),
  created_at timestamptz not null default now()
);

create index if not exists external_market_curation_audit_market_idx
  on zkblast_mainnet.external_market_curation_audit (market_id, created_at desc);

alter table zkblast_mainnet.external_market_curation_audit enable row level security;
revoke all on zkblast_mainnet.external_market_curation_audit from public, anon, authenticated;
grant select, insert on zkblast_mainnet.external_market_curation_audit to service_role;
