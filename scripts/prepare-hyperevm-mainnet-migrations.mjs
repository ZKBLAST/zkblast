import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

const sourceDirectory = "supabase/migrations/mainnet";
const targetDirectory = "supabase/migrations/hyperevm-mainnet";
const selected = [
  "202610160001_identity_and_trade_history.sql",
  "202610160002_atomic_wallet_login.sql",
  "202610170003_protocol_indexer_baseline.sql",
  "202610170004_reorg_safe_events.sql",
  "202610180014_trade_history_receipt_gas.sql",
  "202610200016_protocol_checkpoint_guard.sql",
  "202610310001_dbc_launchpad.sql",
  "202610310002_dbc_launch_metadata.sql",
  "202611010001_launchpad_bindings.sql",
  "202611010002_launchpad_branding.sql",
  "202611010003_dbc_graduation_attempts.sql",
  "202611020001_launchpad_canonical_projection.sql",
  "202611020002_launchpad_developer_integrations.sql",
  "202611020003_launchpad_event_kind.sql",
  "202611020005_chain_qualified_launchpad.sql",
];

await rm(targetDirectory, { recursive: true, force: true });
await mkdir(targetDirectory, { recursive: true });
for (const filename of selected) {
  const source = await readFile(`${sourceDirectory}/${filename}`, "utf8");
  const transformed = source
    .replaceAll("zkblast_mainnet", "zkblast_hyperevm_mainnet")
    .replaceAll("chain_id=4663", "chain_id=999")
    .replaceAll("chain_id = 4663", "chain_id = 999")
    .replaceAll("default 4663", "default 999");
  if (transformed.includes("zkblast_mainnet") || /chain_id\s*=\s*4663/u.test(transformed)) {
    throw new Error(`HYPEREVM_MIGRATION_TRANSFORM_INCOMPLETE:${filename}`);
  }
  await writeFile(`${targetDirectory}/${filename}`, transformed, { mode: 0o644 });
}

const registry = `create table if not exists zkblast_hyperevm_mainnet.chain_registry (
  chain_id bigint primary key check (chain_id = 999),
  chain_key text not null unique check (chain_key = 'hyperevm-mainnet'),
  chain_name text not null check (chain_name = 'HyperEVM'),
  environment text not null check (environment = 'mainnet'),
  native_currency_symbol text not null check (native_currency_symbol = 'HYPE'),
  enabled boolean not null default true check (enabled),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into zkblast_hyperevm_mainnet.chain_registry (
  chain_id,chain_key,chain_name,environment,native_currency_symbol,enabled
) values (999,'hyperevm-mainnet','HyperEVM','mainnet','HYPE',true)
on conflict (chain_id) do update set
  chain_key=excluded.chain_key,
  chain_name=excluded.chain_name,
  environment=excluded.environment,
  native_currency_symbol=excluded.native_currency_symbol,
  enabled=true,
  updated_at=now();

create table if not exists zkblast_hyperevm_mainnet.chain_projection_health (
  chain_id bigint not null references zkblast_hyperevm_mainnet.chain_registry(chain_id) on delete restrict check (chain_id = 999),
  consumer text not null check (consumer ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  latest_observed_block bigint check (latest_observed_block is null or latest_observed_block >= 0),
  latest_finalized_block bigint check (latest_finalized_block is null or latest_finalized_block >= 0),
  latest_projected_block bigint check (latest_projected_block is null or latest_projected_block >= 0),
  lag_blocks bigint check (lag_blocks is null or lag_blocks >= 0),
  healthy boolean not null default false,
  detail_code text check (detail_code is null or detail_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  checked_at timestamptz not null default now(),
  primary key (chain_id,consumer)
);

create index if not exists chain_projection_health_status_idx
  on zkblast_hyperevm_mainnet.chain_projection_health (healthy,checked_at,chain_id);

alter table zkblast_hyperevm_mainnet.chain_registry enable row level security;
alter table zkblast_hyperevm_mainnet.chain_projection_health enable row level security;
revoke all on zkblast_hyperevm_mainnet.chain_registry,zkblast_hyperevm_mainnet.chain_projection_health from public,anon,authenticated;
grant select,insert,update,delete on zkblast_hyperevm_mainnet.chain_registry,zkblast_hyperevm_mainnet.chain_projection_health to service_role;
`;
await writeFile(`${targetDirectory}/202611020004_multichain_registry.sql`, registry, { mode: 0o644 });
console.log(JSON.stringify({ directory: targetDirectory, migrationCount: selected.length + 1, chainId: 999, schema: "zkblast_hyperevm_mainnet", excluded: ["external-market connectors", "perps", "shielded custody"] }, null, 2));
