import assert from "node:assert/strict";
import postgres from "postgres";

assert.equal(process.env.APP_ENV, "mainnet");
assert.equal(process.env.SUPABASE_SCHEMA, "zkblast_mainnet");
assert(process.env.SUPABASE_DIRECT_DATABASE_URL);

const sql = postgres(process.env.SUPABASE_DIRECT_DATABASE_URL, {
  ssl: "require",
  max: 1,
  prepare: false,
});
const expected = [
  "protected_launch_policies",
  "protected_launches",
  "protected_launch_identities",
  "protected_buy_allocations",
  "protected_lp_allocations",
  "protected_graduation_migrations",
  "protected_invariant_alerts",
];
try {
  const [tables, migration, policies] = await Promise.all([
    sql`
      select table_name,
        (select count(*)::integer from information_schema.columns c
         where c.table_schema = 'zkblast_mainnet' and c.table_name = t.table_name) as column_count
      from information_schema.tables t
      where t.table_schema = 'zkblast_mainnet'
      order by table_name
    `,
    sql`
      select filename, checksum, applied_at
      from zkblast_mainnet.schema_migrations
      where filename = '202611030002_protected_launch.sql'
    `,
    sql`select count(*)::integer as count from zkblast_mainnet.protected_launch_policies`,
  ]);
  const names = tables.map(({ table_name }) => table_name);
  const missingProtected = expected.filter((name) => !names.includes(name));
  assert.deepEqual(missingProtected, []);
  assert.equal(migration.length, 1);
  console.log(JSON.stringify({
    schema: "zkblast_mainnet",
    migrationRecorded: true,
    protectedTables: tables.filter(({ table_name }) => expected.includes(table_name)),
    protectedPolicyRows: policies[0].count,
    allTableCount: tables.length,
    allTables: names,
  }, null, 2));
} finally {
  await sql.end();
}
