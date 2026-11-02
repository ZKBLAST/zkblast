create table if not exists zkblast_mainnet.launchpad_api_keys (
  key_id uuid primary key default gen_random_uuid(),
  chain_id integer not null default 4663 check (chain_id=4663),
  launchpad_id numeric(78,0) not null,
  name text not null check (char_length(name) between 1 and 80),
  key_prefix text not null unique check (key_prefix ~ '^zkb_[a-z0-9]{12}$'),
  secret_salt text not null check (secret_salt ~ '^[0-9a-f]{32}$'),
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] not null check (cardinality(scopes) between 1 and 16),
  status text not null default 'active' check (status in ('active','revoked')),
  created_at timestamptz not null default now(), rotated_at timestamptz,
  revoked_at timestamptz, last_used_at timestamptz,
  request_count bigint not null default 0 check (request_count>=0),
  last_rate_limited_at timestamptz,
  foreign key (chain_id,launchpad_id) references zkblast_mainnet.launchpads(chain_id,launchpad_id) on delete cascade
);

create table if not exists zkblast_mainnet.launchpad_webhook_endpoints (
  endpoint_id uuid primary key default gen_random_uuid(),
  chain_id integer not null default 4663 check (chain_id=4663),
  launchpad_id numeric(78,0) not null,
  url text not null check (url like 'https://%' and char_length(url) <= 2048),
  event_types text[] not null check (cardinality(event_types) between 1 and 16),
  secret_ciphertext text not null, secret_iv text not null, secret_tag text not null,
  status text not null default 'pending_verification' check (status in ('pending_verification','active','paused','revoked')),
  verification_token_hash text not null check (verification_token_hash ~ '^[0-9a-f]{64}$'),
  verification_expires_at timestamptz not null, verified_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (launchpad_id,url),
  foreign key (chain_id,launchpad_id) references zkblast_mainnet.launchpads(chain_id,launchpad_id) on delete cascade
);

create table if not exists zkblast_mainnet.launchpad_webhook_deliveries (
  delivery_id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references zkblast_mainnet.launchpad_webhook_endpoints(endpoint_id) on delete cascade,
  event_id text not null,
  event_type text not null,
  payload jsonb not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending','processing','delivered','failed','dead_letter')),
  attempts integer not null default 0 check (attempts between 0 and 20),
  next_attempt_at timestamptz not null default now(),
  last_http_status integer, last_error_code text,
  delivered_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (endpoint_id,event_id)
);

create table if not exists zkblast_mainnet.launchpad_developer_audit_log (
  audit_id bigserial primary key,
  chain_id integer not null default 4663 check (chain_id=4663),
  launchpad_id numeric(78,0) not null,
  actor_address text not null check (actor_address ~ '^0x[0-9a-f]{40}$'),
  action text not null check (action ~ '^[a-z][a-z0-9_.-]{2,63}$'),
  target_id text,
  detail_hash text not null check (detail_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create index launchpad_api_keys_owner_idx on zkblast_mainnet.launchpad_api_keys(launchpad_id,status);
create index launchpad_webhook_delivery_queue_idx on zkblast_mainnet.launchpad_webhook_deliveries(status,next_attempt_at) where status in ('pending','failed');
create index launchpad_developer_audit_idx on zkblast_mainnet.launchpad_developer_audit_log(launchpad_id,created_at desc);
alter table zkblast_mainnet.launchpad_api_keys enable row level security;
alter table zkblast_mainnet.launchpad_webhook_endpoints enable row level security;
alter table zkblast_mainnet.launchpad_webhook_deliveries enable row level security;
alter table zkblast_mainnet.launchpad_developer_audit_log enable row level security;
revoke all on zkblast_mainnet.launchpad_api_keys,zkblast_mainnet.launchpad_webhook_endpoints,zkblast_mainnet.launchpad_webhook_deliveries,zkblast_mainnet.launchpad_developer_audit_log from public,anon,authenticated;
grant select,insert,update,delete on zkblast_mainnet.launchpad_api_keys,zkblast_mainnet.launchpad_webhook_endpoints,zkblast_mainnet.launchpad_webhook_deliveries,zkblast_mainnet.launchpad_developer_audit_log to service_role;
