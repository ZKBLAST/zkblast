import { readdir, readFile } from "node:fs/promises";

const definitions = [
  { environment: "testnet", schema: "zkblast_testnet", chainId: 46630, chainKey: "robinhood-testnet" },
  { environment: "mainnet", schema: "zkblast_mainnet", chainId: 4663, chainKey: "robinhood-mainnet" },
  { environment: "hyperevm-mainnet", schema: "zkblast_hyperevm_mainnet", chainId: 999, chainKey: "hyperevm-mainnet" },
  { environment: "elysium-testnet", schema: "zkblast_elysium_testnet", chainId: 99801, chainKey: "elysium-testnet" },
];

const environments = definitions.map((definition) => ({
  ...definition,
  forbiddenSchemas: definitions
    .filter(({ schema }) => schema !== definition.schema)
    .map(({ schema }) => schema),
}));

for (const { environment, schema, chainId, chainKey, forbiddenSchemas } of environments) {
  const directory = `supabase/migrations/${environment}`;
  const filenames = (await readdir(directory))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();
  const migrations = await Promise.all(
    filenames.map(async (filename) => ({
      path: `${directory}/${filename}`,
      sql: await readFile(`${directory}/${filename}`, "utf8"),
    })),
  );
  const baseline = migrations.find(({ path }) =>
    path.endsWith("202610160001_identity_and_trade_history.sql"),
  );
  if (!baseline) throw new Error(`${directory}: identity baseline is missing`);
  const required = [
    `create schema if not exists ${schema}`,
    `${schema}.users`,
    `${schema}.user_wallets`,
    `${schema}.wallet_login_challenges`,
    `${schema}.user_sessions`,
    `${schema}.login_attempts`,
    `${schema}.trade_history`,
    "enable row level security",
    "revoke all on all tables",
    "grant select, insert, update, delete",
  ];

  for (const fragment of required) {
    if (!baseline.sql.includes(fragment)) {
      throw new Error(
        `${baseline.path}: missing required SQL fragment ${fragment}`,
      );
    }
  }

  for (const migration of migrations) {
    for (const forbiddenSchema of forbiddenSchemas) {
      if (migration.sql.includes(forbiddenSchema)) {
        throw new Error(
          `${migration.path}: cross-environment schema reference ${forbiddenSchema}`,
        );
      }
    }
  }

  if (environment !== "hyperevm-mainnet") {
    const protectedLaunch = migrations.find(({ path }) =>
      path.endsWith("202611030002_protected_launch.sql"),
    );
    if (!protectedLaunch) {
      throw new Error(`${directory}: protected launch migration is missing`);
    }
    for (const fragment of [
      `${schema}.protected_launch_policies`,
      `${schema}.protected_launches`,
      `${schema}.protected_launch_identities`,
      `${schema}.protected_buy_allocations`,
      `${schema}.protected_lp_allocations`,
      `${schema}.protected_graduation_migrations`,
      `${schema}.protected_invariant_alerts`,
      `check (chain_id = ${chainId})`,
      "enable row level security",
      "revoke all on",
      "grant select,insert,update,delete",
    ]) {
      if (!protectedLaunch.sql.includes(fragment)) {
        throw new Error(`${protectedLaunch.path}: missing ${fragment}`);
      }
    }
    if (/\b(drop|truncate)\s+(table|schema)\b/iu.test(protectedLaunch.sql)) {
      throw new Error(`${protectedLaunch.path}: destructive DDL is forbidden`);
    }
  }

  const chainRegistry = migrations.find(({ path }) =>
    path.endsWith("202611020004_multichain_registry.sql"),
  );
  const chainQualified = migrations.find(({ path }) =>
    path.endsWith("202611020005_chain_qualified_launchpad.sql"),
  );
  if (!chainRegistry || !chainQualified) {
    throw new Error(`${directory}: multichain isolation migrations are missing`);
  }
  for (const fragment of [
    `(${chainId},'${chainKey}'`,
    "chain_projection_health",
    "primary key (chain_id,consumer)",
  ]) {
    if (!chainRegistry.sql.includes(fragment)) {
      throw new Error(`${chainRegistry.path}: missing ${fragment}`);
    }
  }
  for (const fragment of [
    "dbc_launches_chain_identity_idx",
    "launchpad_branding_chain_identity_idx",
    "launchpad_webhook_deliveries_chain_event_idx",
  ]) {
    if (!chainQualified.sql.includes(fragment)) {
      throw new Error(`${chainQualified.path}: missing ${fragment}`);
    }
  }
  const fixedChainPattern = new RegExp(
    `default\\s+${chainId}\\s+check\\s*\\(chain_id\\s*=\\s*${chainId}\\)`,
    "u",
  );
  if (!fixedChainPattern.test(chainQualified.sql)) {
    throw new Error(
      `${chainQualified.path}: missing fixed-chain default/check for ${chainId}`,
    );
  }
  for (const forbiddenChainId of [4663, 46630, 998, 999, 99801].filter((value) => value !== chainId)) {
    if (chainQualified.sql.includes(`check (chain_id=${forbiddenChainId})`)) {
      throw new Error(
        `${chainQualified.path}: contains cross-network chain ${forbiddenChainId}`,
      );
    }
  }
}

console.log("Database migration isolation checks passed");
