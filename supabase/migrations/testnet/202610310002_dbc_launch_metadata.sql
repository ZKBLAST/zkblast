create table zkblast_testnet.dbc_launch_metadata (
  metadata_id text primary key check (metadata_id ~ '^[0-9a-f]{64}$'),
  metadata_uri text not null unique check (char_length(metadata_uri) <= 2048),
  website_url text check (website_url is null or char_length(website_url) <= 2048),
  x_url text check (x_url is null or char_length(x_url) <= 2048),
  logo_mime text check (logo_mime is null or logo_mime in ('image/png','image/jpeg','image/webp')),
  logo_bytes bytea check (logo_bytes is null or octet_length(logo_bytes) <= 24576),
  created_at timestamptz not null default now(),
  check ((logo_mime is null) = (logo_bytes is null))
);
alter table zkblast_testnet.dbc_launch_metadata enable row level security;
revoke all on zkblast_testnet.dbc_launch_metadata from public,anon,authenticated;
grant select,insert,update,delete on zkblast_testnet.dbc_launch_metadata to service_role;
