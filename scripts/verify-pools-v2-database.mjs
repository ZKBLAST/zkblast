import assert from "node:assert/strict";
import postgres from "postgres";

const allowed = new Map([
  ["zkblast_testnet", 46630],
  ["zkblast_mainnet", 4663],
  ["zkblast_hyperevm_mainnet", 999],
]);
const schema = process.env.SUPABASE_SCHEMA;
const chainId = Number(process.env.CHAIN_ID);
assert(schema && allowed.has(schema), "Unsupported Pools v2 schema");
assert.equal(chainId, allowed.get(schema), "Schema and chain do not match");
assert(process.env.SUPABASE_DIRECT_DATABASE_URL, "Direct database URL is required");

const sql = postgres(process.env.SUPABASE_DIRECT_DATABASE_URL, {
  ssl: "require",
  max: 1,
  prepare: false,
});
const expectedSwapColumns = [
  "side",
  "trader",
  "recipient",
  "active_bin",
  "reserve0_after_raw",
  "reserve1_after_raw",
  "spot_price_x18",
  "volume_quote_raw",
];
const expectedTables = ["pool_state", "pool_candles", "dlmm_bins"];

try {
  await sql.begin(async (transaction) => {
    await transaction`set transaction read only`;
    const [columns, tables, migration, crossChainRows] = await Promise.all([
      transaction`
        select column_name from information_schema.columns
        where table_schema=${schema} and table_name='swaps'
          and column_name=any(${expectedSwapColumns})
        order by column_name`,
      transaction`
        select t.table_name,c.relrowsecurity as rls_enabled
        from information_schema.tables t
        join pg_namespace n on n.nspname=t.table_schema
        join pg_class c on c.relnamespace=n.oid and c.relname=t.table_name
        where t.table_schema=${schema} and t.table_name=any(${expectedTables})
        order by t.table_name`,
      transaction.unsafe(
        `select filename,checksum,applied_at from ${schema}.schema_migrations
         where filename='202611060001_pools_v2_read_model.sql'`,
      ),
      transaction.unsafe(
        `select count(*)::integer as count from ${schema}.pools where chain_id<>$1`,
        [chainId],
      ),
    ]);
    assert.deepEqual(
      columns.map(({ column_name }) => column_name).sort(),
      [...expectedSwapColumns].sort(),
      "Pools v2 swap columns are incomplete",
    );
    assert.deepEqual(
      tables.map(({ table_name }) => table_name).sort(),
      [...expectedTables].sort(),
      "Pools v2 read tables are incomplete",
    );
    assert(tables.every(({ rls_enabled }) => rls_enabled), "RLS must be enabled");
    assert.equal(migration.length, 1, "Migration ledger entry missing or duplicated");
    assert.equal(crossChainRows[0]?.count, 0, "Cross-chain pool rows detected");
    console.log(JSON.stringify({
      schema,
      chainId,
      migrationRecorded: true,
      swapColumns: expectedSwapColumns,
      tables,
      crossChainPools: 0,
      mode: "read-only",
    }, null, 2));
  });
} finally {
  await sql.end();
}
