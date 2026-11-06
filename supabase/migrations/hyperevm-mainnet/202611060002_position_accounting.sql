-- Immutable LP contribution/withdrawal journal derived from canonical onchain events.
begin;

create table if not exists zkblast_hyperevm_mainnet.position_accounting_events (
  chain_id bigint not null check (chain_id > 0), transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer not null check (log_index >= 0), pool_id uuid not null references zkblast_hyperevm_mainnet.pools(id) on delete cascade,
  onchain_position_id numeric(78, 0) not null check (onchain_position_id > 0), action text not null check (action in ('deposit', 'withdrawal')),
  amount0_raw numeric(78, 0) not null check (amount0_raw >= 0), amount1_raw numeric(78, 0) not null check (amount1_raw >= 0),
  block_number bigint not null check (block_number >= 0), block_hash text not null check (block_hash ~ '^0x[0-9a-f]{64}$'),
  canonical boolean not null default true, created_at timestamptz not null default now(), primary key (chain_id, transaction_hash, log_index)
);
create index if not exists position_accounting_position_idx on zkblast_hyperevm_mainnet.position_accounting_events (pool_id, onchain_position_id, block_number, log_index) where canonical;
create index if not exists position_accounting_reorg_idx on zkblast_hyperevm_mainnet.position_accounting_events (chain_id, block_number);
insert into zkblast_hyperevm_mainnet.position_accounting_events (chain_id,transaction_hash,log_index,pool_id,onchain_position_id,action,amount0_raw,amount1_raw,block_number,block_hash,canonical)
select e.chain_id,e.transaction_hash,e.log_index,p.pool_id,p.onchain_position_id::numeric,case when e.event_name='PositionDecreased' then 'withdrawal' else 'deposit' end,
case when e.event_name='PositionDecreased' then (e.payload->>'amount0')::numeric else (l.payload->>'amount0')::numeric end,
case when e.event_name='PositionDecreased' then (e.payload->>'amount1')::numeric else (l.payload->>'amount1')::numeric end,e.block_number,e.block_hash,true
from zkblast_hyperevm_mainnet.protocol_events e join zkblast_hyperevm_mainnet.positions p on p.onchain_position_id=e.payload->>'positionId'
left join lateral (select pe.payload from zkblast_hyperevm_mainnet.protocol_events pe where pe.chain_id=e.chain_id and pe.transaction_hash=e.transaction_hash and pe.log_index<e.log_index and pe.canonical and pe.event_name in ('LiquidityAdded','BinLiquidityAdded') order by pe.log_index desc limit 1) l on true
where e.canonical and e.event_name in ('PositionCreated','PositionIncreased','PositionDecreased')
and coalesce(case when e.event_name='PositionDecreased' then e.payload->>'amount0' else l.payload->>'amount0' end,'') ~ '^\d+$'
and coalesce(case when e.event_name='PositionDecreased' then e.payload->>'amount1' else l.payload->>'amount1' end,'') ~ '^\d+$'
on conflict (chain_id,transaction_hash,log_index) do nothing;
alter table zkblast_hyperevm_mainnet.position_accounting_events enable row level security;
revoke all on zkblast_hyperevm_mainnet.position_accounting_events from public, anon, authenticated;
grant select, insert, update, delete on zkblast_hyperevm_mainnet.position_accounting_events to service_role;
commit;
