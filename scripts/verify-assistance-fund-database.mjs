import assert from "node:assert/strict";
import postgres from "postgres";

assert.equal(process.env.APP_ENV, "mainnet");
assert.equal(process.env.SUPABASE_SCHEMA, "zkblast_mainnet");
assert(process.env.SUPABASE_DIRECT_DATABASE_URL);

const expectedTables = [
  "assistance_fee_sources",
  "assistance_revenue_receipts",
  "assistance_allocations",
  "assistance_buyback_receipts",
  "assistance_burn_receipts",
  "assistance_reconciliation_snapshots",
];
const sql = postgres(process.env.SUPABASE_DIRECT_DATABASE_URL, {
  ssl: "require",
  max: 1,
  prepare: false,
});

try {
  const [tables, migration, rowCounts] = await Promise.all([
    sql`
      select table_name,
        (select count(*)::integer from information_schema.columns c
         where c.table_schema = 'zkblast_mainnet' and c.table_name = t.table_name) as column_count,
        (select c.relrowsecurity from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'zkblast_mainnet' and c.relname = t.table_name) as rls_enabled
      from information_schema.tables t
      where t.table_schema = 'zkblast_mainnet'
        and t.table_name = any(${expectedTables})
      order by table_name
    `,
    sql`
      select filename, checksum, applied_at
      from zkblast_mainnet.schema_migrations
      where filename = '202611050001_assistance_fund.sql'
    `,
    Promise.all(expectedTables.map(async (table) => {
      const [{ count }] = await sql.unsafe(`select count(*)::integer as count from zkblast_mainnet.${table}`);
      return { table, count };
    })),
  ]);
  assert.deepEqual(tables.map(({ table_name }) => table_name).sort(), [...expectedTables].sort());
  assert(tables.every(({ rls_enabled }) => rls_enabled === true), "RLS must be enabled on all Assistance Fund tables");
  assert.equal(migration.length, 1, "Migration ledger entry missing or duplicated");
  assert(rowCounts.every(({ count }) => count === 0), "Fail-closed deployment must start with empty projections");
  console.log(JSON.stringify({
    schema: "zkblast_mainnet",
    migrationRecorded: true,
    tables,
    rowCounts,
    failClosed: true,
  }, null, 2));
} finally {
  await sql.end();
}
