-- Additive projection of independently accepted DAMM/DLMM stock-quote destinations.
create table if not exists zkblast_testnet.stock_quote_destination_capabilities (
  chain_id integer not null check (chain_id = 46630),
  capability_id text not null check (capability_id ~ '^0x[0-9a-f]{64}$'),
  quote_asset_address text not null check (quote_asset_address ~ '^0x[0-9a-f]{40}$'),
  migration_mode text not null check (migration_mode in ('damm','dlmm')),
  adapter_address text not null check (adapter_address ~ '^0x[0-9a-f]{40}$'),
  factory_address text not null check (factory_address ~ '^0x[0-9a-f]{40}$'),
  adapter_version integer not null check (adapter_version > 0),
  adapter_configuration_hash text not null check (adapter_configuration_hash ~ '^0x[0-9a-f]{64}$'),
  review_reference_hash text not null check (review_reference_hash ~ '^0x[0-9a-f]{64}$'),
  funded_acceptance_hash text check (funded_acceptance_hash is null or funded_acceptance_hash ~ '^0x[0-9a-f]{64}$'),
  registered_at timestamptz not null,
  accepted_at timestamptz,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  check (not enabled or (funded_acceptance_hash is not null and accepted_at is not null)),
  primary key (chain_id, quote_asset_address, migration_mode),
  unique (chain_id, capability_id),
  foreign key (chain_id, quote_asset_address)
    references zkblast_testnet.stock_quote_assets(chain_id, contract_address)
);

create index if not exists stock_quote_destination_enabled_idx
  on zkblast_testnet.stock_quote_destination_capabilities(chain_id, migration_mode, enabled);

alter table zkblast_testnet.stock_quote_destination_capabilities enable row level security;
revoke all on zkblast_testnet.stock_quote_destination_capabilities from public, anon, authenticated;
grant select, insert, update, delete on zkblast_testnet.stock_quote_destination_capabilities to service_role;
