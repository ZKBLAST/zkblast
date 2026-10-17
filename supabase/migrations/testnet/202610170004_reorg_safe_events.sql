create table zkblast_testnet.indexed_blocks (
  chain_id bigint not null, block_number bigint not null check (block_number >= 0),
  block_hash text not null check (block_hash ~ '^0x[0-9a-f]{64}$'),
  parent_hash text not null check (parent_hash ~ '^0x[0-9a-f]{64}$'),
  primary key (chain_id, block_number), unique (chain_id, block_hash)
);
create table zkblast_testnet.protocol_events (
  chain_id bigint not null, transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer not null check (log_index >= 0), block_number bigint not null check (block_number >= 0),
  block_hash text not null check (block_hash ~ '^0x[0-9a-f]{64}$'), contract_address text not null check (contract_address ~ '^0x[0-9a-f]{40}$'),
  event_kind text not null check (event_kind in ('pool','swap','position','liquidity','fee','receipt')),
  event_name text not null, payload jsonb not null default '{}'::jsonb, canonical boolean not null default true,
  created_at timestamptz not null default now(), primary key (chain_id, transaction_hash, log_index)
);
create index protocol_events_kind_block_idx on zkblast_testnet.protocol_events (event_kind, block_number desc, log_index desc) where canonical;
alter table zkblast_testnet.indexed_blocks enable row level security;
alter table zkblast_testnet.protocol_events enable row level security;
revoke all on zkblast_testnet.indexed_blocks, zkblast_testnet.protocol_events from public, anon, authenticated;
grant select, insert, update, delete on zkblast_testnet.indexed_blocks, zkblast_testnet.protocol_events to service_role;
