-- Forward-only compatibility migration. Existing primary keys and fixed-chain
-- defaults remain until every writer uses explicit chain-qualified predicates.
alter table zkblast_hyperevm_mainnet.dbc_templates add column if not exists chain_id integer not null default 999 check (chain_id=999);
alter table zkblast_hyperevm_mainnet.dbc_launches add column if not exists chain_id integer not null default 999 check (chain_id=999);
alter table zkblast_hyperevm_mainnet.dbc_holder_balances add column if not exists chain_id integer not null default 999 check (chain_id=999);
alter table zkblast_hyperevm_mainnet.dbc_graduations add column if not exists chain_id integer not null default 999 check (chain_id=999);
alter table zkblast_hyperevm_mainnet.dbc_lp_allocations add column if not exists chain_id integer not null default 999 check (chain_id=999);
alter table zkblast_hyperevm_mainnet.dbc_monitoring add column if not exists chain_id integer not null default 999 check (chain_id=999);
alter table zkblast_hyperevm_mainnet.dbc_launch_metadata add column if not exists chain_id integer not null default 999 check (chain_id=999);
alter table zkblast_hyperevm_mainnet.dbc_graduation_attempts add column if not exists chain_id integer not null default 999 check (chain_id=999);
alter table zkblast_hyperevm_mainnet.launchpad_branding_versions add column if not exists chain_id integer not null default 999 check (chain_id=999);
alter table zkblast_hyperevm_mainnet.launchpad_profiles add column if not exists chain_id integer not null default 999 check (chain_id=999);
alter table zkblast_hyperevm_mainnet.launchpad_domains add column if not exists chain_id integer not null default 999 check (chain_id=999);
alter table zkblast_hyperevm_mainnet.launchpad_webhook_deliveries add column if not exists chain_id integer not null default 999 check (chain_id=999);

create unique index if not exists dbc_templates_chain_identity_idx on zkblast_hyperevm_mainnet.dbc_templates(chain_id,template_id);
create unique index if not exists dbc_launches_chain_identity_idx on zkblast_hyperevm_mainnet.dbc_launches(chain_id,launch_id);
create unique index if not exists dbc_launches_chain_token_idx on zkblast_hyperevm_mainnet.dbc_launches(chain_id,token_address);
create unique index if not exists dbc_launches_chain_pool_idx on zkblast_hyperevm_mainnet.dbc_launches(chain_id,virtual_pool);
create unique index if not exists dbc_holders_chain_identity_idx on zkblast_hyperevm_mainnet.dbc_holder_balances(chain_id,launch_id,account);
create unique index if not exists dbc_graduations_chain_identity_idx on zkblast_hyperevm_mainnet.dbc_graduations(chain_id,migration_id);
create unique index if not exists dbc_graduations_chain_launch_idx on zkblast_hyperevm_mainnet.dbc_graduations(chain_id,launch_id);
create unique index if not exists dbc_allocations_chain_identity_idx on zkblast_hyperevm_mainnet.dbc_lp_allocations(chain_id,migration_id,allocation_kind);
create unique index if not exists dbc_monitoring_chain_identity_idx on zkblast_hyperevm_mainnet.dbc_monitoring(chain_id,consumer);
create unique index if not exists dbc_metadata_chain_identity_idx on zkblast_hyperevm_mainnet.dbc_launch_metadata(chain_id,metadata_id);
create unique index if not exists dbc_attempts_chain_identity_idx on zkblast_hyperevm_mainnet.dbc_graduation_attempts(chain_id,migration_id);
create unique index if not exists launchpad_branding_chain_identity_idx on zkblast_hyperevm_mainnet.launchpad_branding_versions(chain_id,launchpad_id,version);
create unique index if not exists launchpad_profiles_chain_identity_idx on zkblast_hyperevm_mainnet.launchpad_profiles(chain_id,launchpad_id);
create index if not exists launchpad_profiles_chain_slug_idx on zkblast_hyperevm_mainnet.launchpad_profiles(chain_id,slug);
create index if not exists launchpad_domains_chain_owner_idx on zkblast_hyperevm_mainnet.launchpad_domains(chain_id,launchpad_id,status);
create unique index if not exists launchpad_webhook_endpoints_chain_url_idx on zkblast_hyperevm_mainnet.launchpad_webhook_endpoints(chain_id,launchpad_id,url);
create unique index if not exists launchpad_webhook_deliveries_chain_event_idx on zkblast_hyperevm_mainnet.launchpad_webhook_deliveries(chain_id,endpoint_id,event_id);
