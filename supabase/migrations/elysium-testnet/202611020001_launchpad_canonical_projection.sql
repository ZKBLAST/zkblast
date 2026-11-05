create table if not exists zkblast_elysium_testnet.launchpads (
  chain_id integer not null check (chain_id > 0),
  launchpad_id numeric(78,0) not null check (launchpad_id > 0),
  owner_address text not null check (owner_address ~ '^0x[0-9a-f]{40}$'),
  pending_owner_address text check (pending_owner_address is null or pending_owner_address ~ '^0x[0-9a-f]{40}$'),
  treasury_address text not null check (treasury_address ~ '^0x[0-9a-f]{40}$'),
  pending_treasury_address text check (pending_treasury_address is null or pending_treasury_address ~ '^0x[0-9a-f]{40}$'),
  operator_address text not null check (operator_address ~ '^0x[0-9a-f]{40}$'),
  metadata_hash text not null check (metadata_hash ~ '^0x[0-9a-f]{64}$'),
  slug_commitment text not null check (slug_commitment ~ '^0x[0-9a-f]{64}$'),
  config_preset_id numeric(78,0) not null,
  version integer not null check (version > 0),
  status smallint not null check (status between 0 and 3),
  created_block bigint not null check (created_block >= 0),
  updated_block bigint not null check (updated_block >= created_block),
  transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  updated_at timestamptz not null default now(),
  primary key (chain_id,launchpad_id)
);

create table if not exists zkblast_elysium_testnet.launchpad_metadata_revisions (
  chain_id integer not null,
  launchpad_id numeric(78,0) not null,
  version integer not null check (version > 0),
  previous_metadata_hash text check (previous_metadata_hash is null or previous_metadata_hash ~ '^0x[0-9a-f]{64}$'),
  metadata_hash text not null check (metadata_hash ~ '^0x[0-9a-f]{64}$'),
  transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  block_number bigint not null check (block_number >= 0),
  observed_at timestamptz not null,
  primary key (chain_id,launchpad_id,version),
  foreign key (chain_id,launchpad_id) references zkblast_elysium_testnet.launchpads(chain_id,launchpad_id) on delete cascade
);

create table if not exists zkblast_elysium_testnet.launchpad_fee_policies (
  chain_id integer not null,
  launchpad_id numeric(78,0) not null,
  version integer not null check (version > 0),
  total_trade_fee_bps integer not null check (total_trade_fee_bps between 0 and 300),
  protocol_share_bps integer not null,
  operator_share_bps integer not null,
  creator_share_bps integer not null,
  referral_share_bps integer not null,
  operator_recipient text not null check (operator_recipient ~ '^0x[0-9a-f]{40}$'),
  transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  updated_block bigint not null check (updated_block >= 0),
  updated_at timestamptz not null default now(),
  primary key (chain_id,launchpad_id),
  foreign key (chain_id,launchpad_id) references zkblast_elysium_testnet.launchpads(chain_id,launchpad_id) on delete cascade,
  check (protocol_share_bps + operator_share_bps + creator_share_bps + referral_share_bps = 10000)
);

create table if not exists zkblast_elysium_testnet.launchpad_fee_snapshots (
  chain_id integer not null,
  snapshot_id text not null check (snapshot_id ~ '^0x[0-9a-f]{64}$'),
  launchpad_id numeric(78,0) not null,
  pool_address text not null check (pool_address ~ '^0x[0-9a-f]{40}$'),
  asset_address text check (asset_address is null or asset_address ~ '^0x[0-9a-f]{40}$'),
  policy_version integer not null check (policy_version > 0),
  transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  updated_block bigint not null check (updated_block >= 0),
  updated_at timestamptz not null default now(),
  primary key (chain_id,snapshot_id),
  foreign key (chain_id,launchpad_id) references zkblast_elysium_testnet.launchpads(chain_id,launchpad_id) on delete cascade
);

create table if not exists zkblast_elysium_testnet.launchpad_config_snapshots (
  chain_id integer not null,
  launchpad_id numeric(78,0) not null,
  config_preset_id numeric(78,0) not null,
  config_hash text not null check (config_hash ~ '^0x[0-9a-f]{64}$'),
  graduation_destination smallint not null check (graduation_destination in (1,2)),
  maximum_total_trade_fee_bps integer not null check (maximum_total_trade_fee_bps between 0 and 300),
  version integer not null check (version > 0),
  transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  block_number bigint not null check (block_number >= 0),
  primary key (chain_id,launchpad_id,version),
  foreign key (chain_id,launchpad_id) references zkblast_elysium_testnet.launchpads(chain_id,launchpad_id) on delete cascade
);

create table if not exists zkblast_elysium_testnet.launchpad_referrals (
  chain_id integer not null,
  snapshot_id text not null check (snapshot_id ~ '^0x[0-9a-f]{64}$'),
  recipient_address text not null check (recipient_address ~ '^0x[0-9a-f]{40}$'),
  share_bps integer not null check (share_bps between 0 and 10000),
  updated_block bigint not null check (updated_block >= 0),
  primary key (chain_id,snapshot_id),
  foreign key (chain_id,snapshot_id) references zkblast_elysium_testnet.launchpad_fee_snapshots(chain_id,snapshot_id) on delete cascade
);

create table if not exists zkblast_elysium_testnet.launchpad_webhook_outbox (
  event_id text primary key check (event_id ~ '^[0-9]+:0x[0-9a-f]{64}:[0-9]+$'),
  chain_id integer not null,
  launchpad_id numeric(78,0) not null,
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_.-]{2,63}$'),
  payload jsonb not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  block_number bigint not null check (block_number >= 0),
  status text not null default 'pending' check (status in ('pending','processing','delivered','failed','dead_letter')),
  attempts integer not null default 0 check (attempts between 0 and 20),
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (chain_id,launchpad_id) references zkblast_elysium_testnet.launchpads(chain_id,launchpad_id) on delete cascade
);

create index if not exists launchpads_owner_idx on zkblast_elysium_testnet.launchpads(chain_id,owner_address,updated_block desc);
create index if not exists launchpads_status_idx on zkblast_elysium_testnet.launchpads(chain_id,status,updated_block desc);
create index if not exists launchpad_fee_snapshots_launchpad_idx on zkblast_elysium_testnet.launchpad_fee_snapshots(chain_id,launchpad_id,updated_block desc);
alter table zkblast_elysium_testnet.launchpads enable row level security;
alter table zkblast_elysium_testnet.launchpad_metadata_revisions enable row level security;
alter table zkblast_elysium_testnet.launchpad_fee_policies enable row level security;
alter table zkblast_elysium_testnet.launchpad_fee_snapshots enable row level security;
alter table zkblast_elysium_testnet.launchpad_config_snapshots enable row level security;
alter table zkblast_elysium_testnet.launchpad_referrals enable row level security;
alter table zkblast_elysium_testnet.launchpad_webhook_outbox enable row level security;
revoke all on zkblast_elysium_testnet.launchpads,zkblast_elysium_testnet.launchpad_metadata_revisions,zkblast_elysium_testnet.launchpad_fee_policies,zkblast_elysium_testnet.launchpad_fee_snapshots from public,anon,authenticated;
grant select,insert,update,delete on zkblast_elysium_testnet.launchpads,zkblast_elysium_testnet.launchpad_metadata_revisions,zkblast_elysium_testnet.launchpad_fee_policies,zkblast_elysium_testnet.launchpad_fee_snapshots to service_role;
revoke all on zkblast_elysium_testnet.launchpad_config_snapshots,zkblast_elysium_testnet.launchpad_referrals,zkblast_elysium_testnet.launchpad_webhook_outbox from public,anon,authenticated;
grant select,insert,update,delete on zkblast_elysium_testnet.launchpad_config_snapshots,zkblast_elysium_testnet.launchpad_referrals,zkblast_elysium_testnet.launchpad_webhook_outbox to service_role;
