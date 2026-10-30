import assert from "node:assert/strict";
import postgres from "postgres";

const environment = process.env.APP_ENV;
assert(environment === "testnet" || environment === "mainnet", "APP_ENV must be testnet or mainnet");
const expectedSchema = `zkblast_${environment}`;
assert.equal(process.env.SUPABASE_SCHEMA, expectedSchema, "Database schema does not match APP_ENV");
assert(process.env.SUPABASE_DIRECT_DATABASE_URL, "SUPABASE_DIRECT_DATABASE_URL is required");

const requiredTables = [
  "perp_markets",
  "perp_positions",
  "perp_market_catalog",
  "perp_events",
  "perp_oracle_prices",
  "perp_lp_activity",
  "perp_insurance_activity",
  "perp_vault_snapshots",
  "perp_relayer_jobs",
] as const;
const sql = postgres(process.env.SUPABASE_DIRECT_DATABASE_URL, {
  max: 1,
  connect_timeout: 10,
  idle_timeout: 1,
  prepare: false,
});
try {
  const rows = await sql<{ table_name: string }[]>`
    select table_name
    from information_schema.tables
    where table_schema = ${expectedSchema}
      and table_name = any(${requiredTables as unknown as string[]})
    order by table_name
  `;
  const existing = rows.map((row) => row.table_name);
  const missing = requiredTables.filter((table) => !existing.includes(table));
  console.log(JSON.stringify({
    environment,
    schema: expectedSchema,
    existing,
    missing,
    migrationRequired: missing.length > 0,
  }));
} finally {
  await sql.end({ timeout: 1 });
}
