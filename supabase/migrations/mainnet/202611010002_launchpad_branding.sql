create table zkblast_mainnet.launchpad_branding_versions (
  launchpad_id numeric(78,0) not null,
  version integer not null check (version > 0),
  owner_address text not null check (owner_address ~ '^0x[0-9a-f]{40}$'),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 48),
  name text not null check (char_length(name) between 1 and 80),
  description text not null check (char_length(description) between 1 and 500),
  primary_color text not null check (primary_color ~ '^#[0-9a-f]{6}$'),
  background_color text not null check (background_color ~ '^#[0-9a-f]{6}$'),
  foreground_color text not null check (foreground_color ~ '^#[0-9a-f]{6}$'),
  website_url text check (website_url is null or (website_url like 'https://%' and char_length(website_url) <= 2048)),
  x_url text check (x_url is null or (x_url ~ '^https://(www\.)?(x\.com|twitter\.com)/' and char_length(x_url) <= 2048)),
  logo_mime text check (logo_mime is null or logo_mime in ('image/png','image/jpeg','image/webp')),
  logo_bytes bytea check (logo_bytes is null or octet_length(logo_bytes) <= 256000),
  logo_width integer check (logo_width is null or logo_width between 64 and 1024),
  logo_height integer check (logo_height is null or logo_height between 64 and 1024),
  favicon_mime text check (favicon_mime is null or favicon_mime in ('image/png','image/jpeg','image/webp')),
  favicon_bytes bytea check (favicon_bytes is null or octet_length(favicon_bytes) <= 64000),
  favicon_width integer check (favicon_width is null or favicon_width between 32 and 512),
  favicon_height integer check (favicon_height is null or favicon_height between 32 and 512),
  metadata_hash text not null check (metadata_hash ~ '^0x[0-9a-f]{64}$'),
  signature text not null check (signature ~ '^0x[0-9a-f]{130}$'),
  signed_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (launchpad_id,version),
  check ((logo_mime is null) = (logo_bytes is null)),
  check ((logo_bytes is null) = (logo_width is null) and (logo_width is null) = (logo_height is null)),
  check ((favicon_mime is null) = (favicon_bytes is null)),
  check ((favicon_bytes is null) = (favicon_width is null) and (favicon_width is null) = (favicon_height is null))
);

create table zkblast_mainnet.launchpad_profiles (
  launchpad_id numeric(78,0) primary key,
  current_version integer not null check (current_version > 0),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  metadata_hash text not null check (metadata_hash ~ '^0x[0-9a-f]{64}$'),
  published boolean not null default false,
  updated_at timestamptz not null default now(),
  foreign key (launchpad_id,current_version)
    references zkblast_mainnet.launchpad_branding_versions(launchpad_id,version)
    on delete restrict
);

create table zkblast_mainnet.launchpad_domains (
  domain_id uuid primary key default gen_random_uuid(),
  launchpad_id numeric(78,0) not null references zkblast_mainnet.launchpad_profiles(launchpad_id) on delete cascade,
  hostname text not null unique check (hostname = lower(hostname) and hostname ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'),
  status text not null check (status in ('pending','verified','expired','revoked')),
  challenge_hash text not null check (challenge_hash ~ '^[0-9a-f]{64}$'),
  challenge_expires_at timestamptz not null,
  verified_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status='verified') = (verified_at is not null)),
  check ((status='revoked') = (revoked_at is not null))
);

create index launchpad_profiles_published_idx on zkblast_mainnet.launchpad_profiles (updated_at desc) where published;
create index launchpad_domains_launchpad_idx on zkblast_mainnet.launchpad_domains (launchpad_id,status);
alter table zkblast_mainnet.launchpad_branding_versions enable row level security;
alter table zkblast_mainnet.launchpad_profiles enable row level security;
alter table zkblast_mainnet.launchpad_domains enable row level security;
revoke all on zkblast_mainnet.launchpad_branding_versions,zkblast_mainnet.launchpad_profiles,zkblast_mainnet.launchpad_domains from public,anon,authenticated;
grant select,insert,update,delete on zkblast_mainnet.launchpad_branding_versions,zkblast_mainnet.launchpad_profiles,zkblast_mainnet.launchpad_domains to service_role;
