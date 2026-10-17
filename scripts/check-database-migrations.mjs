import { readdir, readFile } from "node:fs/promises";

for (const environment of ["testnet", "mainnet"]) {
  const schema = `zkblast_${environment}`;
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

  const otherSchema =
    environment === "testnet" ? "zkblast_mainnet" : "zkblast_testnet";
  for (const migration of migrations) {
    if (migration.sql.includes(otherSchema)) {
      throw new Error(
        `${migration.path}: cross-environment schema reference ${otherSchema}`,
      );
    }
  }
}

console.log("Database migration isolation checks passed");
