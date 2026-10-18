alter table zkblast_testnet.external_markets
  add column if not exists oracle_heartbeat_seconds integer;

alter table zkblast_testnet.external_markets
  add constraint external_markets_oracle_heartbeat_check
    check (oracle_heartbeat_seconds is null or oracle_heartbeat_seconds between 1 and 604800);
