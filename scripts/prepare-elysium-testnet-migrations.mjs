import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";

const sourceDirectory = "supabase/migrations/mainnet";
const targetDirectory = "supabase/migrations/elysium-testnet";
const sourceSchema = "zkblast_mainnet";
const targetSchema = "zkblast_elysium_testnet";
const sourceChainId = 4_663;
const targetChainId = 99_801;

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
  "202611030001_chain_event_reconciliation.sql",
  "202611030002_protected_launch.sql",
];

function transform(source, filename) {
  const transformed = source
    .replaceAll(sourceSchema, targetSchema)
    .replaceAll(/chain_id\s*=\s*4663/gu, `chain_id = ${targetChainId}`)
    .replaceAll(/chain_id=4663/gu, `chain_id=${targetChainId}`)
    .replaceAll(/default\s+4663/gu, `default ${targetChainId}`)
    .replaceAll(/values\s*\(4663/gu, `values (${targetChainId}`);
  if (
    transformed.includes(sourceSchema) ||
    new RegExp(`chain_id\\s*=\\s*${sourceChainId}`, "u").test(transformed) ||
    new RegExp(`default\\s+${sourceChainId}`, "u").test(transformed)
  ) {
    throw new Error(`ELYSIUM_MIGRATION_TRANSFORM_INCOMPLETE:${filename}`);
  }
  return transformed;
}

await mkdir(targetDirectory, { recursive: true });
const existing = (await readdir(targetDirectory)).filter((name) => name.endsWith(".sql"));
if (existing.length > 0) {
  throw new Error("ELYSIUM_MIGRATION_DIRECTORY_NOT_EMPTY");
}

for (const filename of selected) {
  const source = await readFile(`${sourceDirectory}/${filename}`, "utf8");
  await writeFile(`${targetDirectory}/${filename}`, transform(source, filename), {
    flag: "wx",
    mode: 0o644,
  });
}

const registry = `create schema if not exists ${targetSchema};

create table if not exists ${targetSchema}.chain_registry (
  chain_id bigint primary key check (chain_id = ${targetChainId}),
  chain_key text not null unique check (chain_key = 'elysium-testnet'),
  chain_name text not null check (chain_name = 'Elysium Testnet'),
  environment text not null check (environment = 'testnet'),
  native_currency_symbol text not null check (native_currency_symbol = 'HYPE'),
  enabled boolean not null default true check (enabled),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into ${targetSchema}.chain_registry (
  chain_id,chain_key,chain_name,environment,native_currency_symbol,enabled
) values (${targetChainId},'elysium-testnet','Elysium Testnet','testnet','HYPE',true)
on conflict (chain_id) do update set
  chain_key=excluded.chain_key,
  chain_name=excluded.chain_name,
  environment=excluded.environment,
  native_currency_symbol=excluded.native_currency_symbol,
  enabled=true,
  updated_at=now();

create table if not exists ${targetSchema}.chain_projection_health (
  chain_id bigint not null references ${targetSchema}.chain_registry(chain_id) on delete restrict check (chain_id = ${targetChainId}),
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
  on ${targetSchema}.chain_projection_health (healthy,checked_at,chain_id);

alter table ${targetSchema}.chain_registry enable row level security;
alter table ${targetSchema}.chain_projection_health enable row level security;
revoke all on ${targetSchema}.chain_registry,${targetSchema}.chain_projection_health from public,anon,authenticated;
grant usage on schema ${targetSchema} to service_role;
grant select,insert,update,delete on ${targetSchema}.chain_registry,${targetSchema}.chain_projection_health to service_role;
`;

await writeFile(
  `${targetDirectory}/202611020004_multichain_registry.sql`,
  registry,
  { flag: "wx", mode: 0o644 },
);

console.log(
  JSON.stringify(
    {
      directory: targetDirectory,
      migrationCount: selected.length + 1,
      chainId: targetChainId,
      schema: targetSchema,
      excluded: [
        "external-market connectors",
        "perps",
        "shielded custody",
        "mainnet-only integrations",
      ],
    },
    null,
    2,
  ),
);
