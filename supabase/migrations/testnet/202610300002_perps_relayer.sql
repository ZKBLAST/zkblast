create table zkblast_testnet.perp_relayer_jobs (
  request_id text primary key check (request_id ~ '^0x[0-9a-f]{64}$'),
  action text not null check (action in ('open','close','modify','claim-liquidated')),
  adapter text not null check (adapter ~ '^0x[0-9a-f]{40}$'),
  calldata text not null check (calldata ~ '^0x[0-9a-f]+$'),
  status text not null check (status in ('queued','processing','submitted','confirmed','failed','expired')) default 'queued',
  transaction_hash text check (transaction_hash is null or transaction_hash ~ '^0x[0-9a-f]{64}$'),
  error_code text check (error_code is null or error_code ~ '^[A-Z0-9_]{1,64}$'),
  deadline timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index perp_relayer_jobs_queue_idx on zkblast_testnet.perp_relayer_jobs (status,created_at) where status='queued';
alter table zkblast_testnet.perp_relayer_jobs enable row level security;
revoke all on zkblast_testnet.perp_relayer_jobs from public, anon, authenticated;
grant select,insert,update,delete on zkblast_testnet.perp_relayer_jobs to service_role;
